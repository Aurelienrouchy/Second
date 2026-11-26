import {providerSecretsForDeployment} from '../config/phase1Deployment';
import { FinancialRecoveryBlocked, withFinancialRecoveryScope } from "../utils/financialRecoveryInterlock";
import { hasActiveBankDispute } from '../utils/bankDispute';
import { hasUnsettledRefund } from '../utils/refundState';
/**
 * User account management callables
 * Firebase Functions v2 — region northamerica-northeast1
 *
 * - deleteUserAccount: durable closure and resumable owner data cleanup
 *   Replaces the v1 auth.user().onDelete() trigger with a v2 callable
 *   that runs all cleanup server-side and deletes the Auth user via Admin SDK.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { db, auth, storage, FieldValue } from '../config/firebase';
import { getStripe } from '../config/stripe';
import { recordPrivacyIncident } from './privacyIncidents';
import { captureServerEvent } from '../lib/analytics';
import { randomUUID } from 'node:crypto';
import { assertRecentAccountAuthentication } from '../utils/eligibility';
import { nativeTime } from '../utils/stripeCheckoutProof';
import {privacyRetentionDecision} from '../utils/privacyRetention';
import {qualifiedWithdrawalNonExecution} from '../utils/withdrawalNonExecution';
import { assertPrivateAccountSession, withPrivateAccountSession } from '../utils/privateAccountSession';
import {assertConnectIdentityPost,reserveConnectIdentityClaim} from '../utils/connectRecoveryIdentity';
import {financialRecoverySourceHash,type FinancialRecoveryDomain} from '../utils/financialRecoverySources';
import {supportSourceHash} from '../utils/supportRequest';
import {readSmallBalanceClosureContext, smallBalanceClosureSource, smallBalanceClosureAmount} from '../utils/smallBalanceClosure';
import {prepareAccountControlPause, readAccountControlPause} from '../utils/accountControlProof';
import {ACCOUNT_ERASURE_PROTOCOL} from '../utils/accountErasureContract';
import {accountErasureProviderSecrets,getAccountErasureService} from '../utils/accountErasureService';

const closureRef = (uid: string) => db.collection('eligibility_profiles').doc(uid);
const CLOSURE_LEASE_MS = 3 * 60_000;
/** Read again after the barrier is acquired. No provider outcome is inferred
 * from a zero wallet or a missing/unknown status. All reads precede writes. */
export type DeletionObligationSource = 'purchases_buyer'|'purchases_seller'|'disputes_buyer'|'disputes_seller'|'withdrawals'|'swaps_initiated'|'swaps_received'|'forfaits';
export async function deletionObligations(tx: FirebaseFirestore.Transaction, uid: string, profile: FirebaseFirestore.DocumentData,
  options?: {maxDocumentsPerSource?: number; inspectionPage?: {source: DeletionObligationSource; page: FirebaseFirestore.QuerySnapshot}}) {
  const limit = options?.maxDocumentsPerSource;
  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000)) throw new HttpsError('invalid-argument', 'Borne d’inspection invalide.');
  const scoped = (source: DeletionObligationSource, query: FirebaseFirestore.Query) => options?.inspectionPage
    ? Promise.resolve(source === options.inspectionPage.source ? options.inspectionPage.page :
      {docs: [], size: 0, empty: true} as unknown as FirebaseFirestore.QuerySnapshot)
    : tx.get(limit === undefined ? query : query.limit(limit + 1));
  const user = (await tx.get(db.collection('users').doc(uid))).data();
  const walletDoc = await tx.get(db.collection('wallets').doc(uid));
  const txAsBuyer = await scoped('purchases_buyer', db.collection('transactions').where('buyerId', '==', uid));
  const txAsSeller = await scoped('purchases_seller', db.collection('transactions').where('sellerId', '==', uid));
  const disputesBuyer = await scoped('disputes_buyer', db.collection('disputes').where('buyerId', '==', uid));
  const disputesSeller = await scoped('disputes_seller', db.collection('disputes').where('sellerId', '==', uid));
  const withdrawals = await scoped('withdrawals', db.collection('withdrawal_requests').where('userId', '==', uid));
  const swapsInit = await scoped('swaps_initiated', db.collection('swaps').where('initiatorId', '==', uid));
  const swapsRecv = await scoped('swaps_received', db.collection('swaps').where('receiverId', '==', uid));
  const forfaits = await scoped('forfaits', db.collection('eligibility_audit').where('ownerId', '==', uid).where('action', '==', 'account_forfait_operation'));
  if (limit !== undefined && [txAsBuyer, txAsSeller, disputesBuyer, disputesSeller, withdrawals, swapsInit, swapsRecv, forfaits].some(page => page.size > limit)) {
    return {blockers: ['financial_source_scope_requires_pagination'], walletDoc, txAsBuyer, txAsSeller,
      financialAbsenceHash: supportSourceHash({protocol: 'account_deletion_scope_incomplete_v1', ownerId: uid, limit, qualified: false}),
      financialScopeQualified: false, hasDisputeEvidence: !disputesBuyer.empty || !disputesSeller.empty};
  }
  const blockers: string[] = [];
  if(profile.accountClosure?.exceptionalRestitution!=null&&!await (await import('../utils/exceptionalRestitution')).exceptionalWalletRestitutionAllowsClosure(tx,uid,profile.accountClosure.exceptionalRestitution))
    blockers.push('exceptional_restitution_unsettled');
  if ((await privacyRetentionDecision(tx, uid)).blocked) blockers.push('privacy_retention_review_required');
  const orders = new Map([...txAsBuyer.docs, ...txAsSeller.docs].map(doc => [doc.id, doc.data()]));
  let blockingDispute = false;
  for (const doc of [...disputesBuyer.docs, ...disputesSeller.docs]) {
    const dispute = doc.data(), id = dispute.transactionId;
    const terminalDispute = (dispute.status === 'resolved' && nativeTime(dispute.resolvedAt)) ||
      (dispute.status === 'closed' && nativeTime(dispute.closedAt));
    // Cash/no-show also needs its recourse to be closed. Missing/unknown status,
    // timestamp or linked parties is operator review, never proof of closure.
    if (!terminalDispute || typeof id !== 'string' || !id || id.includes('/')) { blockingDispute = true; continue; }
    const order = orders.get(id) ?? (await tx.get(db.collection('transactions').doc(id))).data();
    if (!order || order.buyerId !== dispute.buyerId || order.sellerId !== dispute.sellerId ||
        ![order.buyerId, order.sellerId].includes(uid)) blockingDispute = true;
  }
  if (profile.accountClosure?.requiresOperator === true) blockers.push('financial_reconciliation_required');
  for (const d of [...txAsBuyer.docs, ...txAsSeller.docs]) {
    const order = d.data();
    if (order.walletCheckoutOutcome === 'unknown') { blockers.push('card_operation_unsettled'); break; }
    if (order.status === 'cancelled') {
      const intent = (await tx.get(db.collection('stripe_checkout_intents').doc(d.id))).data();
      const hasCardOperation = !!order.stripePaymentIntentId || !!intent;
      if (hasCardOperation && !(intent?.state === 'retired' && intent.cardCapabilityNeutralized === true && intent.providerStatus === 'canceled') &&
          !(intent?.state === 'canceled' && intent.providerStatus === 'canceled')) {
        blockers.push('card_operation_unsettled'); break;
      }
    }
  }
  if (walletDoc.exists && ['balance', 'pendingBalance', 'heldBalance', 'sellerDebt'].some(field => {
    const wallet = walletDoc.data()!;
    const value = Object.prototype.hasOwnProperty.call(wallet, field) ? wallet[field] : 0;
    return !Number.isSafeInteger(value) || value !== 0;
  })) blockers.push('wallet_funds_or_debt');
  // The explicit closure capability may settle the entire native small
  // available balance through the SAME withdrawal engine. This diagnostic is
  // only guidance; every financial guard and deletion obligation still applies.
  const available = walletDoc.data()?.balance;
  if (Number.isSafeInteger(available) && available > 0 && available < 1000 &&
      typeof walletDoc.data()?.currency === 'string' && walletDoc.data()!.currency.toUpperCase() === 'CAD') {
    blockers.push(smallBalanceClosureSource(uid,profile.accountClosure) && smallBalanceClosureAmount(walletDoc.data())!==null
      ? 'small_balance_closure_withdrawal' : 'small_balance_closure_assistance');
  }
  if (blockingDispute) blockers.push('dispute_unsettled');
  const terminal = ['completed', 'cancelled', 'refunded', 'meetup_completed'];
  if ([...txAsBuyer.docs, ...txAsSeller.docs].some(d => {
    const order = d.data();
    if (hasActiveBankDispute(order) || hasUnsettledRefund(order)) return true;
    return typeof order.status !== 'string' || !terminal.includes(order.status);
  })) blockers.push('active_transaction');
  for (const d of withdrawals.docs) {
    const withdrawal = d.data();
    if (withdrawal.status === 'not_executed' && await qualifiedWithdrawalNonExecution(tx, uid, d.ref, withdrawal)) continue;
    if (!['completed', 'failed'].includes(withdrawal.status) || withdrawal.payoutOutcome === 'unknown' ||
        withdrawal.transferOutcome === 'unknown' || withdrawal.reconciliationRequired === true) {
      blockers.push('withdrawal_unsettled'); break;
    }
  }
  if ([...swapsInit.docs, ...swapsRecv.docs].some(d => {
    const swap = d.data();
    return !['declined', 'cancelled', 'completed'].includes(swap.status) ||
      (!!swap.topUpPaidAt && !swap.topUpReleasedAt && !swap.topUpRefundedAt) ||
      (!!swap.topUpPaymentIntentId && !swap.topUpReleasedAt && !swap.topUpRefundedAt) ||
      (!!swap.topUpCheckoutState && !['rejected', 'canceled'].includes(swap.topUpCheckoutState) && !swap.topUpReleasedAt && !swap.topUpRefundedAt);
  })) blockers.push('swap_unsettled');
  const connect = profile.connectOperation;
  if ((connect && !(connect.state === 'rejected' || (connect.state === 'linked' && typeof connect.providerId === 'string' &&
      connect.providerId === user?.stripeAccountId))) || (!connect && user?.stripeAccountCreationStartedAt && !user?.stripeAccountId)) {
    blockers.push('connect_operation_unsettled');
  }
  if (forfaits.docs.some(d => !['settled', 'rejected', 'canceled'].includes(d.data().state))) blockers.push('forfait_operation_unsettled');
  if (profile.bankOperation && !['completed', 'rejected', 'candidate_unavailable', 'not_started'].includes(profile.bankOperation.state)) blockers.push('bank_operation_unsettled');
  const financialRows=(rows:FirebaseFirestore.QuerySnapshot,domain:FinancialRecoveryDomain)=>rows.docs.map(d=>({path:d.ref.path,
    nativeHash:financialRecoverySourceHash(domain,d.data()),status:d.data().status??null})).sort((a,b)=>a.path.localeCompare(b.path));
  const financialAbsenceHash=supportSourceHash({protocol:options?.inspectionPage ? 'account_deletion_partial_inspection_v1' : 'account_deletion_financial_absences_v1',ownerId:uid,
    wallet:{path:walletDoc.ref.path,exists:walletDoc.exists,nativeHash:walletDoc.exists?financialRecoverySourceHash('wallet',walletDoc.data()!):null},
    purchasesAsBuyer:financialRows(txAsBuyer,'purchase'),purchasesAsSeller:financialRows(txAsSeller,'purchase'),
    disputes:[...disputesBuyer.docs,...disputesSeller.docs].map(d=>({path:d.ref.path,nativeHash:supportSourceHash(d.data())})).sort((a,b)=>a.path.localeCompare(b.path)),
    withdrawals:financialRows(withdrawals,'withdrawal'),swapsAsInitiator:financialRows(swapsInit,'swap'),swapsAsReceiver:financialRows(swapsRecv,'swap'),
    forfaits:financialRows(forfaits,'shop_tier'),bankOperation:profile.bankOperation??null,connectOperation:profile.connectOperation??null});
  return { blockers, walletDoc, txAsBuyer, txAsSeller,financialAbsenceHash,financialScopeQualified: !options?.inspectionPage,hasDisputeEvidence: !disputesBuyer.empty || !disputesSeller.empty };
}

// =============================================================================
// DELETE USER ACCOUNT — durable closure and resumable cleanup
// =============================================================================

export const deleteUserAccount = onCall(
  {
    region: 'northamerica-northeast1',
    memory: '512MiB',
    timeoutSeconds: 120,
    secrets: [...providerSecretsForDeployment(['STRIPE_SECRET_KEY']),...accountErasureProviderSecrets()],
  },
  async (request) => {
    if(request.data?.capability!==undefined){
      if(request.data.capability!==ACCOUNT_ERASURE_PROTOCOL)throw new HttpsError('invalid-argument','Protocole de suppression non reconnu.');
      return getAccountErasureService().handle(request);
    }
    return withFinancialRecoveryScope({operation:"callable/users.deleteUserAccount"}, async () => {
    // 1. Auth check — only the authenticated user can delete their own account
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentification requise');
    }

    const uid = request.auth.uid;
    const DELETED_NAME = 'Utilisateur supprime';
    /** Pseudonyme stable qui remplace l'uid partout où il doit disparaître. */
    const DELETED_UID = `deleted_${uid.slice(0, 8)}`;

    // Exact A06 receipts remain observable after the original recent consent;
    // its narrow hook applies recent/linked-provider admission only to NEW.
    if (request.data?.accountControlProof === undefined) assertRecentAccountAuthentication(request.auth.token);
    const mode = request.data?.mode ?? 'delete';
    if (mode !== 'pause' && mode !== 'delete') throw new HttpsError('invalid-argument', 'Mode de fermeture invalide');
    const profileRef = closureRef(uid), userRef = db.collection('users').doc(uid);
    // Acquire independently of obligations. A concurrent admission either commits
    // before this write (and is seen below), or retries against the closed barrier.
    // Only these admission phases are currently reachable. Keep their private
    // returns guarded without imposing an Auth read after a future, separately
    // authorized destructive sequence has itself removed the Auth account.
    const initial = await withPrivateAccountSession(request, () => db.runTransaction(async tx => {
      await assertPrivateAccountSession(request, tx);
      const profile = (await tx.get(profileRef)).data() ?? {};
      const user = (await tx.get(userRef)).data();
      const prior = profile.accountClosure;
      const control = await prepareAccountControlPause(tx, request, prior);
      if (control?.replayed) return prior ?? {phase:'unrecorded'};
      if (prior != null) {
        if (prior.schemaVersion !== 1 || prior.ownerId !== uid) throw new HttpsError('failed-precondition', 'La fermeture doit être examinée par notre équipe.');
        control?.commit(prior, FieldValue.serverTimestamp());
        return prior;
      }
      const pauseAt = FieldValue.serverTimestamp();
      const closure = { schemaVersion: 1, ownerId: uid, phase: 'paused', status: 'paused',
        requestedAt: pauseAt, leaseUntilMs: 0,
        ...(control ? {accountControlProof:control.link} : {}),
        cleanup: { username: typeof user?.username === 'string' ? user.username : null,
          stripeAccountId: typeof user?.stripeAccountId === 'string' ? user.stripeAccountId : null, articleIds: [] } };
      tx.set(profileRef, { accountClosure: closure }, { merge: true });
      control?.commit(closure, pauseAt);
      return closure;
    }));
    if (request.data?.accountControlProof !== undefined) {
      const accountControlProof = await readAccountControlPause(request);
      return {success:true,status:accountControlProof?.proof?.pauseObserved===true?'paused':'incomplete',
        // A past receipt never grants reopening, including a closure that has
        // since advanced or a neutralized pause with no new barrier effect.
        deletionComplete:false,newOperationsBlocked:true,action:'resolveExistingObligations',
        accountControlProof};
    }
    if (initial.phase === 'complete') return { success: true, status: 'complete', deletionComplete: true, newOperationsBlocked: true };
    const readSmallSettlement = () => withPrivateAccountSession(request, () => db.runTransaction(async tx => {
      await assertPrivateAccountSession(request,tx);
      return readSmallBalanceClosureContext(tx,uid);
    }));
    if (mode === 'pause') return { success: true, status: initial.phase === 'paused' ? 'paused' : 'incomplete',
      deletionComplete: false, newOperationsBlocked: true, action: 'resolveExistingObligations',
      smallBalanceSettlement:await readSmallSettlement() };

    const attemptId = randomUUID();
    const admission = await withPrivateAccountSession(request, () => db.runTransaction(async tx => {
      await assertPrivateAccountSession(request, tx);
      const profile = (await tx.get(profileRef)).data() ?? {}, closure = profile.accountClosure;
      const userDoc = await tx.get(userRef);
      if (!closure || closure.ownerId !== uid || closure.schemaVersion !== 1) throw new HttpsError('failed-precondition', 'Fermeture à examiner.');
      if (closure.phase === 'complete') return { ready: false as const, status: 'complete', blockers: [] as string[] };
      if (closure.leaseUntilMs > Date.now()) return { ready: false as const, status: 'incomplete', blockers: ['cleanup_in_progress'] };
      const obligations = await deletionObligations(tx, uid, profile);
      // No approved cross-service disposal protocol currently qualifies a NEW
      // destructive sequence. Decide before touching Firestore/profile/media.
      // Existing native provider/Auth checkpoints are retained as history;
      // an unknown escaped outcome is never called cancelled or successful.
      const externalReview = {protocol: 'privacy_external_erasure_review_v1', ownerId: uid,
        newDestructionAuthorized: false, state: 'not_executed_requires_review',
        reason: 'external_erasure_retention_review_required',
        reviewCondition: 'qualified_cross_service_retention_protocol',
        providerHistory: closure.providerAccountDeleted === true && nativeTime(closure.providerAccountDeletedAt)
          ? 'native_deletion_recorded' : closure.providerDeletionStartedAt ? 'outcome_unknown' : 'no_effect_proved',
        authHistory: nativeTime(closure.authDeletedAt) ? 'native_deletion_recorded' : 'no_effect_proved',
        mediaHistory: closure.phase === 'purging' ? 'outcome_unknown' : 'no_effect_proved',
        recordedAt: FieldValue.serverTimestamp(), historicalEffectReversed: false};
      if (!externalReview.newDestructionAuthorized) {
        const blockers = [...new Set([...obligations.blockers, externalReview.reason])];
        tx.update(profileRef, {'accountClosure.status': closure.phase === 'paused' ? 'paused' : 'incomplete',
          'accountClosure.blockers': blockers, 'accountClosure.externalErasureReview': externalReview,
          'accountClosure.checkedAt': FieldValue.serverTimestamp(), 'accountClosure.leaseUntilMs': 0});
        return {ready: false as const, status: closure.phase === 'paused' ? 'paused' : 'incomplete', blockers};
      }
      if (obligations.blockers.length) {
        tx.update(profileRef, { 'accountClosure.status': closure.phase === 'paused' ? 'paused' : 'incomplete',
          'accountClosure.blockers': obligations.blockers, 'accountClosure.checkedAt': FieldValue.serverTimestamp() });
        return { ready: false as const, status: closure.phase === 'paused' ? 'paused' : 'incomplete', blockers: obligations.blockers };
      }
      const accountId=typeof userDoc.data()?.stripeAccountId==='string'?userDoc.data()!.stripeAccountId:
        typeof closure.cleanup?.stripeAccountId==='string'?closure.cleanup.stripeAccountId:null;
      const identityRequestHash=supportSourceHash({protocol:'account_deletion_identity_command_v1',ownerId:uid,accountId,
        financialAbsenceHash:obligations.financialAbsenceHash});
      const identityClaim=await reserveConnectIdentityClaim(tx,uid,'delete',attemptId,identityRequestHash,accountId,obligations.financialAbsenceHash);
      tx.update(profileRef, { 'accountClosure.phase': 'purging', 'accountClosure.status': 'incomplete',
        'accountClosure.attemptId': attemptId, 'accountClosure.leaseUntilMs': Date.now() + CLOSURE_LEASE_MS,
        'accountClosure.identityClaim':{protocol:identityClaim.protocol,commandId:attemptId,requestHash:identityRequestHash,
          financialAbsenceHash:obligations.financialAbsenceHash,accountId,epoch:identityClaim.epoch},
        'accountClosure.blockers': [], 'accountClosure.checkedAt': FieldValue.serverTimestamp() });
      if (userDoc.exists) tx.update(userRef, { isActive: false });
      return { ready: true as const, ...obligations, userDoc, closure,identityRequestHash,identityAccountId:accountId };
    }));
    if (!admission.ready) return { success: admission.status === 'complete', status: admission.status,
      deletionComplete: admission.status === 'complete', newOperationsBlocked: true, blockers: admission.blockers,
      smallBalanceSettlement:await readSmallSettlement(),
      action: admission.blockers.includes('cleanup_in_progress') ? 'retryLater' :
        admission.blockers.includes('small_balance_closure_withdrawal') ? 'settleSmallBalance' :
        admission.blockers.includes('small_balance_closure_assistance') || admission.blockers.includes('external_erasure_retention_review_required') ||
        admission.blockers.includes('privacy_retention_review_required') ? 'contactSupport' : 'resolveExistingObligations' };
    const { walletDoc, txAsSeller, userDoc } = admission;
    const userData = userDoc.data() ?? admission.closure.cleanup ?? {};
    const incompleteParts: string[] = [];
    const articleIds: string[] = Array.isArray(admission.closure.cleanup?.articleIds) ? [...admission.closure.cleanup.articleIds] : [];
    const queuedWrites: (() => Promise<void>)[] = [];
    let writeFailed = false, privacyBlocked = false;
    const mutate = async (ref: FirebaseFirestore.DocumentReference, patch?: FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData>) => {
      try {
        await db.runTransaction(async tx => {
          const profile = (await tx.get(profileRef)).data(), target = await tx.get(ref);
          if (profile?.accountClosure?.attemptId !== attemptId) throw new Error('Closure lease changed');
          if ((await privacyRetentionDecision(tx, uid)).blocked) {privacyBlocked = true; return;}
          if (!target.exists) return;
          if (ref.parent.id === 'usernames' && target.data()?.uid !== uid) return;
          if (patch) tx.update(ref, patch); else tx.delete(ref);
        });
      } catch (recoveryFailure) {
      if (recoveryFailure instanceof FinancialRecoveryBlocked) throw recoveryFailure;writeFailed = true;}
    };
    const bulkWriter = {
      delete(ref: FirebaseFirestore.DocumentReference) { queuedWrites.push(() => mutate(ref)); },
      update(ref: FirebaseFirestore.DocumentReference, data: FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData>) {
        queuedWrites.push(() => mutate(ref, data));
      },
      async close() {
        for (let offset = 0; offset < queuedWrites.length; offset += 8) await Promise.all(queuedWrites.slice(offset, offset + 8).map(run => run()));
        if (writeFailed || privacyBlocked) throw new Error(privacyBlocked ? 'Privacy preservation requires review' : 'Firestore cleanup incomplete');
      },
    };
    try {
    // Cosmetic counters use the closure receipt so a cleanup retry cannot debit
    // them twice. Missing sellers are skipped without losing the witness.
    if (Array.isArray(userData.likedSellers) && userData.likedSellers.length) {
      await db.runTransaction(async tx => {
        const profile = (await tx.get(profileRef)).data();
        if (profile?.accountClosure?.likesCleanupDone === true) return;
        if ((await privacyRetentionDecision(tx, uid)).blocked) {privacyBlocked = true; return;}
        const ids = [...new Set(userData.likedSellers.filter((id: unknown): id is string => typeof id === 'string' && id.length > 0))] as string[];
        const sellers = ids.length ? await tx.getAll(...ids.map(id => db.collection('users').doc(id))) : [];
        for (const seller of sellers) if (seller.exists) tx.update(seller.ref, { sellerLikesCount: FieldValue.increment(-1) });
        tx.update(profileRef, { 'accountClosure.likesCleanupDone': true });
      });
    }

    // 1. Delete owner sub-collections; defer the user document until Auth is absent.
    for (const subCol of ['savedSearches', 'searchHistory', 'consents']) {
      const subSnap = await db.collection('users').doc(uid).collection(subCol).get();
      for (const d of subSnap.docs) bulkWriter.delete(d.ref);
    }
    // Keep the public source until Auth deletion is confirmed; it is inactive
    // and the private barrier remains authoritative even if it is recreated.

    // 1b. Release the persistent @username reservation in usernames/{username}.
    // assignUsername reserves usernames/{username} = { uid } permanently; without
    // this the handle stays orphaned (pointing at a deleted uid) and is never
    // re-attributable. Verify ownership (.exists && .uid === uid) before deleting
    // so a stale/mismatched mapping is never clobbered. The private checkpoint
    // also preserves the handle if an older purge already removed the user doc.
    if (userData?.username && typeof userData.username === 'string') {
      const usernameRef = db.collection('usernames').doc(userData.username);
      const usernameSnap = await usernameRef.get();
      if (usernameSnap.exists && usernameSnap.data()?.uid === uid) {
        bulkWriter.delete(usernameRef);
      }
    }

    // 2. Deactivate listings without erasing owner/provenance or photographs.
    // A late dossier must still bind the original owner after cleanup starts.
    const articlesSnap = await db.collection('articles').where('sellerId', '==', uid).get();
    for (const d of articlesSnap.docs) if (!articleIds.includes(d.id)) articleIds.push(d.id);
    // Keep the checkpoint for retries, including attempts started by older code.
    await profileRef.update({ 'accountClosure.cleanup.articleIds': articleIds });
    for (const d of articlesSnap.docs) {
      bulkWriter.update(d.ref, {
        isActive: false,
      });
    }
    const retainOwnerMedia = articleIds.length > 0 || !admission.txAsBuyer.empty || !txAsSeller.empty || admission.hasDisputeEvidence;

    // 3. Cleanup search_index entries for the user's articles
    for (const articleId of articleIds) {
      const siRef = db.collection('search_index').doc(articleId);
      const siSnap = await siRef.get();
      if (siSnap.exists) bulkWriter.delete(siRef);
    }

    // 4. Deactivate corresponding embeddings
    for (const articleId of articleIds) {
      const embRef = db.collection('embeddings').doc(articleId);
      const embSnap = await embRef.get();
      if (embSnap.exists) bulkWriter.update(embRef, { isActive: false });
    }

    // 5. Delete /favorites/{uid}
    const favRef = db.collection('favorites').doc(uid);
    const favSnap = await favRef.get();
    if (favSnap.exists) bulkWriter.delete(favRef);

    // 6. Delete notifications
    const notifsSnap = await db.collection('notifications').where('userId', '==', uid).get();
    for (const d of notifsSnap.docs) bulkWriter.delete(d.ref);

    // 7. Anonymise chats. participantsInfo is always an array of
    //    { userId, userName, userImage } (chatService writes only this shape).
    const chatsSnap = await db.collection('chats').where('participants', 'array-contains', uid).get();
    for (const d of chatsSnap.docs) {
      const info = d.data().participantsInfo;
      if (Array.isArray(info)) {
        const updated = info.map((p: any) =>
          p.userId === uid ? { ...p, userName: DELETED_NAME, userImage: null } : p
        );
        bulkWriter.update(d.ref, { participantsInfo: updated, updatedAt: FieldValue.serverTimestamp() });
      }
    }

    // 7b. Anonymise messages sent by the user (batch 500) et ÉTEINT ses offres
    //     encore vivantes. Une offre ne réserve pas l'article : elle survivait
    //     donc à la fermeture du compte de son auteur, et le vendeur pouvait
    //     l'accepter le lendemain — verrouillant son article pendant 48 h au
    //     profit d'un acheteur qui n'existe plus, avec pour seul signal un
    //     « Utilisateur supprimé » dans la conversation et des boutons actifs.
    const LIVE_OFFER_STATUSES = new Set([
      'pending',
      'counter_price',
      'counter_location',
      'counter_time',
    ]);
    let expiredOffers = 0;
    let msgQuery = db.collection('messages').where('senderId', '==', uid).limit(500);
    let msgSnap = await msgQuery.get();
    while (!msgSnap.empty) {
      for (const d of msgSnap.docs) {
        const md = d.data();
        const offerStatus = md?.offer?.status;
        if (md?.type === 'offer' && typeof offerStatus === 'string' && LIVE_OFFER_STATUSES.has(offerStatus)) {
          bulkWriter.update(d.ref, {
            senderName: DELETED_NAME,
            senderImage: null,
            'offer.status': 'expired',
            'offer.expiredReason': 'sender_account_deleted',
            'offer.expiredAt': FieldValue.serverTimestamp(),
          });
          expiredOffers++;
          continue;
        }
        bulkWriter.update(d.ref, {
          senderName: DELETED_NAME,
          senderImage: null,
        });
      }
      if (msgSnap.size < 500) break;
      msgQuery = db.collection('messages').where('senderId', '==', uid).startAfter(msgSnap.docs[msgSnap.docs.length - 1]).limit(500);
      msgSnap = await msgQuery.get();
    }
    if (expiredOffers > 0) {
      logger.info('[deleteUserAccount] Expired live offers of the deleted sender', {
        uid,
        expiredOffers,
      });
    }

    // 8a. Anonymise reviews -- reviews written BY the user
    const reviewsByUser = await db.collection('avis').where('reviewerId', '==', uid).get();
    for (const d of reviewsByUser.docs) {
      bulkWriter.update(d.ref, {
        reviewerName: DELETED_NAME,
        reviewerImage: null,
      });
    }

    // 8b. Anonymise reviews -- reviews received BY the user (vendeurId == uid)
    const reviewsForUser = await db.collection('avis').where('vendeurId', '==', uid).get();
    for (const d of reviewsForUser.docs) {
      // Keep the review content but anonymise the target identity
      bulkWriter.update(d.ref, {
        vendeurId: DELETED_UID,
      });
    }

    // 8c. Preserve dispute identities and statements in their existing private
    // documents. Any open/unqualified no-show now prevents purge admission.
    // Closed/unknown dossiers also stay here; a separate retention decision
    // must qualify the current terminal status and linked order before any
    // eventual purge. No stale snapshot is queued for destructive bulk writes.

    // 9. Retain existing swap contracts and provider recovery identities.
    const [swapsInit, swapsRecv] = await Promise.all([
      db.collection('swaps').where('initiatorId', '==', uid).get(),
      db.collection('swaps').where('receiverId', '==', uid).get(),
    ]);
    const deletedSwapIds = new Set<string>();
    for (const d of [...swapsInit.docs, ...swapsRecv.docs]) {
      if (deletedSwapIds.has(d.id)) continue;
      deletedSwapIds.add(d.id);
      const swap = d.data();
      const patch: FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData> = {};
      if (swap.initiatorId === uid) { patch.initiatorName = DELETED_NAME; patch.initiatorImage = null; }
      if (swap.receiverId === uid) { patch.receiverName = DELETED_NAME; patch.receiverImage = null; }
      if (Object.keys(patch).length) bulkWriter.update(d.ref, patch);
    }

    // 10. Delete the user's Swap Zone items + decrement itemsCount per zone.
    // (No more swapPartyParticipants — the Swap Zone is open to all, no join.)
    const piSnap = await db.collection('swapPartyItems').where('sellerId', '==', uid).get();

    const partyDecrements: Record<string, { items: number }> = {};
    for (const d of piSnap.docs) {
      const partyId = d.data().partyId;
      if (partyId) {
        if (!partyDecrements[partyId]) partyDecrements[partyId] = { items: 0 };
        partyDecrements[partyId].items += 1;
      }
      bulkWriter.delete(d.ref);
    }

    // Decrement itemsCount on affected zones
    for (const [partyId, counts] of Object.entries(partyDecrements)) {
      if (counts.items > 0) {
        const partyRef = db.collection('swapParties').doc(partyId);
        bulkWriter.update(partyRef, {
          itemsCount: FieldValue.increment(-counts.items),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    }

    // 12. Preserve orders, participant IDs and the no-show statement copied in
    // the order. A statement remains recourse evidence even without platform
    // funds. Closure does not determine its retention duration or erase it on
    // a stale terminal snapshot while a concurrent dossier could be reopening.

    // Financial evidence is retained with transaction identifiers. A later
    // refund/dispute/payout recovery must still find its wallet and ledger.
    const walletSnap = walletDoc;

    // 15. Drafts may be provenance of legacy publication media. With retained
    // articles/contracts/dossiers, cleanup cannot qualify their destruction.
    if (!retainOwnerMedia) {
      const draftsSnap = await db.collection('drafts').where('userId', '==', uid).get();
      for (const d of draftsSnap.docs) bulkWriter.delete(d.ref);
    }

    // Flush all Firestore writes
    await bulkWriter.close();
    logger.info('[deleteUserAccount] Firestore cleanup complete', {
      uid,
      articlesDeactivated: articleIds.length,
      searchIndexDeleted: articleIds.length,
      reviewsAnonymised: reviewsByUser.size,
      swapsAnonymised: deletedSwapIds.size,
      orderProofsRetained: true,
      disputeProofsRetained: true,
      ownerMediaRetained: retainOwnerMedia,
      offersExpired: expiredOffers,
      walletRetained: walletSnap.exists,
    });

    // 16. Retain owner media associated with any retained source, even before
    // a concurrent financial recheck. Retention qualification is separate;
    // no legal duration is inferred by this cleanup.
    const storagePrefixes = retainOwnerMedia ? [] : [
      `users/${uid}/`,
      `products/${uid}/`,
      `drafts/${uid}/`,
    ];
    try {
      const bucket = storage.bucket();
      for (const prefix of storagePrefixes) {
        try {
          await bucket.deleteFiles({ prefix });
        } catch (e) {
      if (e instanceof FinancialRecoveryBlocked) throw e;
          incompleteParts.push('storage');
          logger.error('[deleteUserAccount] Storage cleanup error', { uid, prefix, error: e });
        }
      }
      // This legacy path is one exact object; a prefix without '/' could erase
      // a different owner's file whose UID starts with this UID.
      try { if (!retainOwnerMedia) await bucket.file(`avatars/${uid}`).delete({ ignoreNotFound: true }); }
      catch (error) {
      if (error instanceof FinancialRecoveryBlocked) throw error;
        incompleteParts.push('storage');
        logger.error('[deleteUserAccount] Avatar cleanup error', { uid, error });
      }
    } catch (e) {
      if (e instanceof FinancialRecoveryBlocked) throw e;
      incompleteParts.push('storage');
      logger.error('[deleteUserAccount] Storage cleanup error', { uid, error: e });
    }

    const recheckObligations = async () => db.runTransaction(async tx => {
      const profile = (await tx.get(profileRef)).data() ?? {};
      if (profile.accountClosure?.attemptId !== attemptId) throw new Error('Closure lease changed');
      const current = await deletionObligations(tx, uid, profile);
      if(current.financialAbsenceHash!==admission.financialAbsenceHash)throw new FinancialRecoveryBlocked('deletion_financial_absences_changed');
      tx.update(profileRef, { 'accountClosure.blockers': current.blockers, 'accountClosure.checkedAt': FieldValue.serverTimestamp() });
      return current.blockers;
    });
    const beforeProvider = await recheckObligations();
    if (beforeProvider.length || incompleteParts.length) {
      await profileRef.update({ 'accountClosure.status': 'incomplete', 'accountClosure.leaseUntilMs': 0,
        'accountClosure.incompleteParts': [...new Set(incompleteParts)] });
      return { success: false, status: 'incomplete', deletionComplete: false, newOperationsBlocked: true,
        blockers: beforeProvider, incompleteParts: [...new Set(incompleteParts)], action: 'retryOrContactSupport' };
    }

    // 16b. Delete the Stripe Connect Custom account (white-label — the platform
    //      owns/controls the account). A successful response is checkpointed for
    //      Auth/cleanup retries. An unknown provider outcome keeps the closure
    //      incomplete and requires retry or operator reconciliation.
    const stripeAccountId = userData?.stripeAccountId ?? admission.closure.cleanup?.stripeAccountId;
    if (typeof stripeAccountId === 'string' && stripeAccountId.length > 0 && admission.closure.providerAccountDeleted !== true) {
      try {
        if (admission.closure.providerDeletionStartedAt) throw new Error('Previous provider deletion requires reconciliation');
        const stripe = getStripe();
        if (!stripe) {
          throw new Error('Stripe client unavailable (missing STRIPE_SECRET_KEY)');
        }
        await db.runTransaction(async tx=>{
          const profile=(await tx.get(profileRef)).data();
          if(profile?.accountClosure?.attemptId!==attemptId||profile.accountClosure.providerDeletionStartedAt)throw new FinancialRecoveryBlocked('provider_deletion_requires_reconciliation');
          const current=await deletionObligations(tx,uid,profile);
          if(current.blockers.length||current.financialAbsenceHash!==admission.financialAbsenceHash)throw new FinancialRecoveryBlocked('deletion_financial_absences_changed');
          await assertConnectIdentityPost(uid,'delete',attemptId,admission.identityRequestHash,stripeAccountId);
          tx.update(profileRef,{'accountClosure.providerDeletionStartedAt':FieldValue.serverTimestamp()});
        });
        const deletedAccount = await stripe.accounts.del(stripeAccountId,{}, {idempotencyKey:'connect_delete_'+attemptId});
        if (deletedAccount.deleted !== true || deletedAccount.id !== stripeAccountId) throw new Error('Provider deletion unconfirmed');
        await profileRef.update({ 'accountClosure.providerAccountDeleted': true,
          'accountClosure.providerAccountDeletedAt': FieldValue.serverTimestamp() });
        logger.info('[deleteUserAccount] Stripe Connect account deleted', {
          uid,
          stripeAccountId,
        });
      } catch (e: unknown) {
      if (e instanceof FinancialRecoveryBlocked) throw e;
        incompleteParts.push('provider_account');
        const message = e instanceof Error ? e.message : 'Unknown error';
        logger.error('[deleteUserAccount] Failed to delete Stripe Connect account', {
          uid,
          stripeAccountId,
          error: message,
        });
        // Record an incident so the orphaned Stripe account can be reconciled manually.
        await recordPrivacyIncident({
          type: 'deletion_failed',
          severity: 'high',
          description: `Échec de la suppression du compte Stripe Connect lors de la suppression du compte utilisateur. Compte Stripe orphelin à supprimer manuellement. Erreur: ${message}`,
          affectedUserIds: [uid],
          affectedDataFields: ['stripeAccountId'],
          measures: 'Suppression manuelle du compte Stripe Connect requise.',
          notifiedCAI: false,
          status: 'open',
        });
        // Keep Auth and the barrier while the provider deletion remains unconfirmed.
      }
    }

    const finalBlockers = await recheckObligations();
    if (finalBlockers.length || incompleteParts.length) {
      await profileRef.update({ 'accountClosure.status': 'incomplete', 'accountClosure.leaseUntilMs': 0,
        'accountClosure.incompleteParts': [...new Set(incompleteParts)] });
      return { success: false, status: 'incomplete', deletionComplete: false, newOperationsBlocked: true,
        blockers: finalBlockers, incompleteParts: [...new Set(incompleteParts)], action: 'retryOrContactSupport' };
    }

    // 17. Delete Firebase Auth user (last step — after all data is cleaned up)
    try {
      await assertConnectIdentityPost(uid,'delete',attemptId,admission.identityRequestHash,admission.identityAccountId);
      await auth.deleteUser(uid);
      logger.info('[deleteUserAccount] Auth user deleted', { uid });
    } catch (e: any) {
      if (e instanceof FinancialRecoveryBlocked) throw e;
      if (e.code !== 'auth/user-not-found') {
        logger.error('[deleteUserAccount] Failed to delete Auth user', { uid, error: e });
        await profileRef.update({ 'accountClosure.status': 'incomplete', 'accountClosure.leaseUntilMs': 0,
          'accountClosure.incompleteParts': ['authentication'] });
        return { success: false, status: 'incomplete', deletionComplete: false, newOperationsBlocked: true,
          incompleteParts: ['authentication'], action: 'retryOrContactSupport' };
      }
    }

    const completion = await db.runTransaction(async tx => {
      const profile = (await tx.get(profileRef)).data();
      if (profile?.accountClosure?.attemptId !== attemptId) throw new Error('Closure lease changed');
      // Auth IO cannot be atomic with Firestore. Re-read real financial sources
      // at the final commit; a re-opened dossier keeps user/proofs and operator access.
      const current = await deletionObligations(tx, uid, profile!);
      if (current.blockers.length) {
        tx.update(profileRef, { 'accountClosure.phase': 'purging', 'accountClosure.status': 'incomplete',
          'accountClosure.authDeletedAt': FieldValue.serverTimestamp(), 'accountClosure.requiresOperator': true,
          'accountClosure.blockers': current.blockers, 'accountClosure.incompleteParts': ['financial_obligation'],
          'accountClosure.leaseUntilMs': 0, 'accountClosure.checkedAt': FieldValue.serverTimestamp() });
        return { complete: false as const, blockers: current.blockers };
      }
      tx.delete(userRef);
      tx.update(profileRef, { 'accountClosure.phase': 'complete', 'accountClosure.status': 'complete',
        'accountClosure.completedAt': FieldValue.serverTimestamp(), 'accountClosure.leaseUntilMs': 0,
        'accountClosure.authDeletedAt': FieldValue.serverTimestamp(),
        'accountClosure.cleanup': FieldValue.delete(), 'accountClosure.incompleteParts': [] });
      return { complete: true as const, blockers: [] as string[] };
    });
    if (!completion.complete) return { success: false, status: 'incomplete', deletionComplete: false, newOperationsBlocked: true,
      authDeleted: true, blockers: completion.blockers, incompleteParts: ['financial_obligation'], action: 'contactSupport' };
    // Emit account_deleted only after Auth absence and final checkpoint.
    // distinct_id = deleted uid; this is not proof of legal retention compliance.
    // signup_method from the Firebase sign-in provider (reliable, no Firestore
    // field dependency). had_wallet_balance reflects whether a wallet existed
    // (deletion is gated on a ZERO balance, so any funds are already withdrawn).
    {
      const signInProvider =
        (request.auth.token as { firebase?: { sign_in_provider?: string } } | undefined)
          ?.firebase?.sign_in_provider ?? 'password';
      const signupMethod =
        signInProvider === 'google.com'
          ? 'google'
          : signInProvider === 'apple.com'
            ? 'apple'
            : 'email';
      let accountAgeDays = 0;
      const createdAt = userData?.createdAt;
      if (createdAt && typeof createdAt.toMillis === 'function') {
        accountAgeDays = Math.max(
          0,
          Math.round((Date.now() - createdAt.toMillis()) / (24 * 60 * 60 * 1000))
        );
      }
      await captureServerEvent(uid, 'account_deleted', {
        signup_method: signupMethod,
        account_age_days: accountAgeDays,
        had_sales: !txAsSeller.empty,
        had_wallet_balance: walletDoc.exists,
        $insert_id: `account_deleted_${uid}`,
      });
    }

    logger.info('[deleteUserAccount] Full cleanup done', { uid });
    return { success: true, status: 'complete', deletionComplete: true, newOperationsBlocked: true };
    } catch (error) {
      if (error instanceof FinancialRecoveryBlocked) throw error;
      await db.runTransaction(async tx => {
        const profile = (await tx.get(profileRef)).data();
        if (profile?.accountClosure?.attemptId === attemptId && profile.accountClosure.phase !== 'complete') {
          tx.update(profileRef, { 'accountClosure.status': 'incomplete', 'accountClosure.leaseUntilMs': 0,
            'accountClosure.incompleteParts': [privacyBlocked ? 'privacy_preservation' : 'cleanup'],
            ...(privacyBlocked ? {'accountClosure.blockers': ['privacy_retention_review_required']} : {}),
            'accountClosure.failedAt': FieldValue.serverTimestamp() });
        }
      });
      logger.error('[deleteUserAccount] Cleanup incomplete', { uid, error: error instanceof Error ? error.message : 'Unknown error' });
      return { success: false, status: 'incomplete', deletionComplete: false, newOperationsBlocked: true,
        incompleteParts: [privacyBlocked ? 'privacy_preservation' : 'cleanup'],
        ...(privacyBlocked ? {blockers: ['privacy_retention_review_required']} : {}), action: 'retryOrContactSupport' };
    }
  });
  }
);
