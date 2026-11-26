import {assertPrivateAccountSession, withPrivateAccountSession} from '../utils/privateAccountSession';
import { createHash } from 'node:crypto';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { Timestamp } from 'firebase-admin/firestore';
import { db, storage } from '../config/firebase';
import { storageObjectPath } from '../utils/articleMedia';
import { preservePrivateImage, readPrivateImage, sourceImageWitness, PrivateImageWitness, nativeSwapAgreement, readNativeOrderAgreement } from '../utils/privateMedia';
import { preserveArticleReportEvidenceBeforeDeletion } from '../utils/reportEvidence';
import {articlePrivacyHash} from '../utils/articlePrivacyContract';
import {privacyArticleProof,privacyPublicArticle,privacyPublicPartyItem,withArticlePrivacyScope} from '../utils/localArticlePrivacy';
import {assertFinancialRecoveryEffect,withFinancialRecoveryScope} from '../utils/financialRecoveryInterlock';
import {privacyRetentionDecision} from '../utils/privacyRetention';

const options = { region: 'northamerica-northeast1', memory: '512MiB' as const, timeoutSeconds: 120 };
const hash = articlePrivacyHash;
const evidenceRef = (articleId: string) => db.collection('article_privacy_evidence').doc(articleId);
const commandRef = (uid: string, articleId: string, requestId: string) => db.collection('article_privacy_commands').doc(hash([uid, articleId, requestId]));
const iso = (date: unknown): string | null => date instanceof Timestamp ? date.toDate().toISOString() : null;
const validId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);

type Media = {
  mediaId: string; sourceUrl: string | null; sourcePath: string | null;
  sourceReferenceHashes: string[];
  state: 'pending' | 'copied' | 'revoked' | 'needs_review'; reason: string | null;
  sourceGeneration: string | null; sourceCrc32c: string | null; size: number | null;
  contentType: string | null; privatePath: string | null; privateGeneration: string | null;
};

function requestIdentity(request: { auth?: { uid: string } | null; data: any }): { uid: string; articleId: string } {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Connexion requise.');
  if (request.data?.expectedUid !== request.auth.uid) throw new HttpsError('permission-denied', 'La session a changé.');
  if (!validId(request.data?.articleId)) throw new HttpsError('invalid-argument', 'Article invalide.');
  return { uid: request.auth.uid, articleId: request.data.articleId };
}

function withdrawalDto(op: FirebaseFirestore.DocumentData | undefined, articleId: string, uid: string, requestId: string, replay: boolean) {
  if (!op) return { kind: 'article_privacy_withdrawal_v1', ownerId: uid, articleId, requestId,
    operationId: null, state: 'unrecorded', intentCommitted: false, replay, publicWithdrawalComplete: false,
    privateEvidenceAvailable: false, mediaTotal: 0, mediaRevoked: 0, mediaNeedsReview: 0,
    createdAt: null, updatedAt: null, completedAt: null, downloadedCopiesRecallable: false };
  if (op.ownerId !== uid || op.requestId !== requestId || op.articleId !== articleId || op.schemaVersion !== 1) {
    throw new HttpsError('failed-precondition', 'Une autre intention de retrait existe pour cet article.', { reason: 'privacy_intent_conflict' });
  }
  if (op.operationId !== hash([uid, articleId, requestId])
      || op.payloadHash !== hash([uid, articleId, requestId, 'withdraw_public'])
      || !(op.createdAt instanceof Timestamp) || op.sourceSnapshot?.sellerId !== uid
      || op.sourceSnapshotHash !== hash([op.sourceSnapshot, op.sourceUpdatedAt])) {
    throw new HttpsError('failed-precondition', 'Preuve native de retrait incohérente.');
  }
  const media: Media[] = op.media ?? [];
  return { kind: 'article_privacy_withdrawal_v1', ownerId: uid, articleId, requestId, operationId: op.operationId,
    state: op.state, intentCommitted: true, replay, publicWithdrawalComplete: op.state === 'completed',
    privateEvidenceAvailable: true, mediaTotal: media.length, mediaRevoked: media.filter(m => m.state === 'revoked').length,
    mediaNeedsReview: media.filter(m => m.state === 'needs_review').length,
    createdAt: iso(op.createdAt), updatedAt: iso(op.updatedAt), completedAt: iso(op.completedAt),
    downloadedCopiesRecallable: false };
}

function nonExecutionDto(receipt: FirebaseFirestore.DocumentData, uid: string, articleId: string, requestId: string, replay: boolean) {
  const operationId = hash([uid, articleId, requestId]);
  if (receipt.schemaVersion !== 1 || receipt.ownerId !== uid || receipt.articleId !== articleId || receipt.requestId !== requestId
      || receipt.operationId !== operationId || receipt.payloadHash !== hash([uid, articleId, requestId, 'withdraw_public'])
      || receipt.state !== 'not_executed' || receipt.noWithdrawalEffectsCommitted !== true || receipt.lateRequestBlocked !== true
      || !(receipt.committedAt instanceof Timestamp) || !/^[a-f0-9]{64}$/.test(receipt.blockingOperationId ?? '')
      || receipt.blockingOperationId === operationId) throw new HttpsError('failed-precondition', 'Non-exécution à examiner.');
  return { kind: 'article_privacy_withdrawal_v1', ownerId: uid, articleId, requestId, operationId,
    state: 'not_executed', intentCommitted: true, replay, publicWithdrawalComplete: false, privateEvidenceAvailable: false,
    mediaTotal: 0, mediaRevoked: 0, mediaNeedsReview: 0, createdAt: iso(receipt.committedAt), updatedAt: iso(receipt.committedAt),
    completedAt: null, downloadedCopiesRecallable: false, noWithdrawalEffectsCommitted: true, lateRequestBlocked: true,
    nonExecutionCommittedAt: iso(receipt.committedAt) };
}

const partyTombstone=privacyPublicPartyItem;
function publicTombstone(article:FirebaseFirestore.DocumentData,marker:FirebaseFirestore.DocumentData){
  const projected=privacyPublicArticle(article,marker);
  return {...projected,...privacyArticleProof('articles/'+marker.articleId,article,projected)};
}

const referenceHash = (url: string) => createHash('sha256').update(url, 'utf8').digest('hex');
function initialMedia(snapshots: FirebaseFirestore.DocumentData[], uid: string, articleId: string): Media[] {
  const urls = new Set<string>();
  for (const snapshot of snapshots) for (const image of Array.isArray(snapshot.images) ? snapshot.images : []) {
    const url = typeof image === 'string' ? image : image?.url;
    if (typeof url === 'string') urls.add(url);
  }
  for (const snapshot of snapshots) if (typeof snapshot.imageUrl === 'string') urls.add(snapshot.imageUrl);
  const rows: Media[] = [];
  for (const url of urls) {
    const path = storageObjectPath(url, storage.bucket().name);
    const owned = path && (path.startsWith(`articles/${articleId}/`) || path.startsWith(`drafts/${uid}/`) || path.startsWith(`products/${uid}/`));
    const old = owned ? rows.find(m => m.sourcePath === path) : undefined;
    if (old) { old.sourceReferenceHashes.push(referenceHash(url)); continue; }
    rows.push({ mediaId: hash([articleId, owned ? path : url]), sourceUrl: url, sourcePath: owned ? path : null,
      sourceReferenceHashes: [referenceHash(url)],
      state: owned ? 'pending' : 'needs_review', reason: owned ? null : 'external_or_unqualified_source',
      sourceGeneration: null, sourceCrc32c: null, size: null, contentType: null, privatePath: null, privateGeneration: null });
  }
  return rows;
}

async function commitMedia(articleId: string, operationId: string, media: Media): Promise<void> {
  await db.runTransaction(async tx => {
    const ref = evidenceRef(articleId), snap = await tx.get(ref), op = snap.data();
    if (!op || op.operationId !== operationId) throw new HttpsError('failed-precondition', 'Preuve de retrait incohérente.');
    const current: Media[] = op.media;
    const old = current.find(m => m.mediaId === media.mediaId);
    // A slower concurrent response cannot downgrade a committed revocation.
    if (old?.state === 'revoked') return;
    tx.update(ref, { media: current.map(m => m.mediaId === media.mediaId ? media : m), updatedAt: Timestamp.now() });
  });
}

async function preserveAndRevoke(articleId: string, operationId: string, original: Media): Promise<void> {
  if (original.state === 'revoked' || !original.sourcePath) return;
  let media = { ...original };
  const sourcePath = original.sourcePath;
  const bucket = storage.bucket();
  const privatePath = `article_privacy/${articleId}/${operationId}/${media.mediaId}`;
  try {
    if (!media.sourceGeneration) {
      const [metadata] = await bucket.file(sourcePath).getMetadata();
      media = { ...media, ...sourceImageWitness(metadata), privatePath };
      // Freeze the exact source generation before any external IO.
      await commitMedia(articleId, operationId, media);
    }
    const source = bucket.file(sourcePath, { generation: media.sourceGeneration! });
    const privateGeneration = await preservePrivateImage(sourcePath, privatePath, media as PrivateImageWitness, operationId, media.mediaId);
    media = { ...media, state: 'copied', reason: null, privatePath, privateGeneration };
    await commitMedia(articleId, operationId, media);
    if (!sourcePath.startsWith(`articles/${articleId}/`)) {
      // Legacy staged objects are owner-editable and may be shared by another
      // publication. Keep a qualified private copy, but do not revoke another
      // listing's source without a native ownership/reference manifest.
      media.state = 'needs_review'; media.reason = 'legacy_shared_source_requires_review';
      await commitMedia(articleId, operationId, media); return;
    }
    // Delete the exact public generation, including its bearer download token.
    // Never delete a replacement generation or claim a lost source was copied.
    // A report captured before the public tombstone keeps its own exact pixels.
    // Pending transport leaves this withdrawal resumable, never public again.
    await preserveArticleReportEvidenceBeforeDeletion(articleId, [sourcePath]);
    try { await source.delete({ ifGenerationMatch: media.sourceGeneration! }); }
    catch (error: unknown) {
      if (!(typeof error === 'object' && error && 'code' in error && Number(error.code) === 404)) throw error;
    }
    const [currentSourceExists] = await bucket.file(sourcePath).exists();
    if (currentSourceExists) {
      media.state = 'needs_review'; media.reason = 'public_replacement_generation_exists';
    } else { media.state = 'revoked'; media.reason = null; }
    await commitMedia(articleId, operationId, media);
  } catch (error) {
    if (error instanceof HttpsError && error.code === 'failed-precondition') {
      media.state = 'needs_review'; media.reason = 'media_proof_unqualified';
      await commitMedia(articleId, operationId, media);
    }
    // Unknown remains durable and resumable through request with the SAME ID.
    logger.warn('article_privacy_media_pending', { articleId, operationId, mediaId: media.mediaId,
      code: error instanceof HttpsError ? error.code : 'storage_unqualified' });
  }
}

async function redactReviewTitles(articleId: string, operationId: string): Promise<void> {
  const op = (await evidenceRef(articleId).get()).data()!;
  const queries: FirebaseFirestore.Query[] = [db.collection('avis').where('articleId', '==', articleId)];
  const swapIds: string[] = op.affectedSwapIds ?? [];
  for (let i = 0; i < swapIds.length; i += 30) queries.push(db.collection('avis').where('transactionId', 'in', swapIds.slice(i, i + 30)));
  let complete = true;
  for (const query of queries) {
    const rows = await query.limit(201).get();
    if (rows.size > 200) complete = false;
    for (const row of rows.docs.slice(0, 200)) {
      await db.runTransaction(async tx => {
        const retained = evidenceRef(articleId).collection('public_projection_evidence').doc(hash([row.ref.path]));
        const [articleSnap, currentSnap, retainedSnap] = await Promise.all([tx.get(db.collection('articles').doc(articleId)), tx.get(row.ref), tx.get(retained)]);
        const current = currentSnap.data();
        if (articleSnap.data()?.privacyWithdrawal?.operationId !== operationId || !current) return;
        if (current.articleId !== articleId && !(current.transactionType === 'swap' && swapIds.includes(current.transactionId))) return;
        if (!retainedSnap.exists) tx.create(retained, { schemaVersion: 1, operationId, articleId,
          sourcePath: row.ref.path, sourceUpdatedAt: currentSnap.updateTime, sourceSnapshot: current,
          sourceSnapshotHash: hash([current, currentSnap.updateTime]), capturedAt: Timestamp.now() });
        tx.update(row.ref, { articleTitle: 'Annonce retirée pour confidentialité' });
      });
    }
  }
  await db.runTransaction(async tx => {
    const ref = evidenceRef(articleId), current = (await tx.get(ref)).data();
    if (current?.operationId === operationId) tx.update(ref, { publicProjectionScanComplete: complete, updatedAt: Timestamp.now() });
  });
}

type ArticleWithdrawalIntention={uid:string;articleId:string;requestId:string;assertIntention:(tx:FirebaseFirestore.Transaction)=>Promise<unknown>};
async function executeArticleWithdrawal(intention:ArticleWithdrawalIntention,mode:'request'|'observe') {
  const {uid,articleId,requestId}=intention;
  return withFinancialRecoveryScope({operation:'callable/articlePrivacy.withdrawArticlePrivacy'},()=>
    withArticlePrivacyScope(uid,articleId,requestId,async()=>{
  const ref = evidenceRef(articleId), articleRef = db.collection('articles').doc(articleId);
  const intentRef = commandRef(uid, articleId, requestId);
  if (mode === 'observe') {
    const [snapshot, command] = await Promise.all([ref.get(), intentRef.get()]);
    if (snapshot.data()?.requestId === requestId) {
      if (command.exists) throw new HttpsError('failed-precondition', 'Recevabilité de l’intention à examiner.');
      return withdrawalDto(snapshot.data(), articleId, uid, requestId, true);
    }
    if (command.exists) return nonExecutionDto(command.data()!, uid, articleId, requestId, true);
    if (!snapshot.exists) {
      const article = (await articleRef.get()).data();
      if (!article || article.sellerId !== uid) throw new HttpsError('permission-denied', 'Pas votre article.');
    }
    return withdrawalDto(snapshot.data(), articleId, uid, requestId, true);
  }
  const operationId = hash([uid, articleId, requestId]);
  const replay = await db.runTransaction(async tx => {
    // Admission of the owner's withdrawal joins the current session/barrier
    // read set. Already committed redaction work below remains preserved even
    // if its caller is later revoked; the outer guard withholds its response.
    await intention.assertIntention(tx);
    const [opSnap, ownCommand, articleSnap, items, orders, initiatorSwaps, receiverSwaps] = await Promise.all([tx.get(ref), tx.get(intentRef), tx.get(articleRef),
      tx.get(db.collection('swapPartyItems').where('articleId', '==', articleId).limit(101)),
      tx.get(db.collection('transactions').where('articleId', '==', articleId).limit(101)),
      tx.get(db.collection('swaps').where('initiatorId', '==', uid).limit(51)),
      tx.get(db.collection('swaps').where('receiverId', '==', uid).limit(51))]);
    if (opSnap.data()?.requestId === requestId) {
      withdrawalDto(opSnap.data(), articleId, uid, requestId, true);
      if (ownCommand.exists) throw new HttpsError('failed-precondition', 'Recevabilité de l’intention à examiner.');
      return true;
    }
    if (ownCommand.exists) { nonExecutionDto(ownCommand.data()!, uid, articleId, requestId, true); return true; }
    if (opSnap.exists) {
      const other = opSnap.data()!;
      withdrawalDto(other, articleId, uid, other.requestId, true);
      if (articleSnap.data()?.sellerId !== uid || articleSnap.data()?.privacyWithdrawal?.operationId !== other.operationId) {
        throw new HttpsError('failed-precondition', 'Retrait précédent non qualifié.');
      }
      // The immutable global operation is created in the same FIRST transaction
      // as the barrier, before any media IO. A different command can never have
      // started effects without owning that operation; this receipt neutralizes
      // B forever while preserving A unchanged. No absence/timeout inference.
      tx.create(intentRef, { schemaVersion: 1, ownerId: uid, articleId, requestId, operationId,
        payloadHash: hash([uid, articleId, requestId, 'withdraw_public']), state: 'not_executed',
        noWithdrawalEffectsCommitted: true, lateRequestBlocked: true, blockingOperationId: other.operationId, committedAt: Timestamp.now() });
      return true;
    }
    const article = articleSnap.data();
    if (!article || article.sellerId !== uid) throw new HttpsError('permission-denied', 'Pas votre article.');
    const now = Timestamp.now();
    const orderRows = orders.docs.slice(0, 100).filter(d => d.data().sellerId === uid);
    const swapItems = (swap: FirebaseFirestore.DocumentData) => [...(swap.initiatorItems ?? (swap.initiatorItem ? [swap.initiatorItem] : [])),
      ...(swap.receiverItems ?? (swap.receiverItem ? [swap.receiverItem] : []))].filter(item => item.articleId === articleId);
    const swapRows = [...initiatorSwaps.docs.slice(0, 50), ...receiverSwaps.docs.slice(0, 50)]
      .filter(d => swapItems(d.data()).length > 0);
    const allMedia = initialMedia([article, ...orderRows.map(d => d.data().articleSnapshot ?? {}),
      ...swapRows.flatMap(d => swapItems(d.data()))], uid, articleId);
    const media = allMedia.slice(0, 100);
    const captureComplete = items.size <= 100 && orders.size <= 100 && initiatorSwaps.size <= 50
      && receiverSwaps.size <= 50 && allMedia.length <= 100;
    const marker = { schemaVersion: 1, articleId, operationId, withdrawnAt: now };
    await assertFinancialRecoveryEffect('firestore_commit',{refs:[ref.path]});
    tx.create(ref, { schemaVersion: 1, ownerId: uid, articleId, requestId, operationId,
      payloadHash: hash([uid, articleId, requestId, 'withdraw_public']), state: 'pending',
      sourceSnapshot: article, sourceUpdatedAt: articleSnap.updateTime,
      sourceSnapshotHash: hash([article, articleSnap.updateTime]), media, assetScanComplete: false,
      contractCaptureComplete: captureComplete, affectedSwapIds: swapRows.map(d => d.id), publicProjectionScanComplete: false,
      createdAt: now, updatedAt: now, completedAt: null });
    tx.set(articleRef, publicTombstone(article, marker));
    tx.delete(db.collection('search_index').doc(articleId));
    tx.delete(db.collection('embeddings').doc(articleId));
    for (const order of orderRows) tx.update(order.ref, { articlePrivacyWithdrawal: marker });
    for (const swap of swapRows) tx.update(swap.ref, { [`articlePrivacyWithdrawals.${articleId}`]: marker });
    for (const item of items.docs.slice(0, 100)) {
      // Keep ownership, pending/swapped state and references for ongoing swaps.
      tx.create(ref.collection('public_projection_evidence').doc(hash([item.ref.path])), { schemaVersion: 1, operationId, articleId,
        sourcePath: item.ref.path, sourceUpdatedAt: item.updateTime, sourceSnapshot: item.data(),
        sourceSnapshotHash: hash([item.data(), item.updateTime]), capturedAt: now });
      tx.set(item.ref, partyTombstone(item.data(), marker));
    }
    return false;
  });
  const nonExecution = await intentRef.get();
  if (nonExecution.exists) return nonExecutionDto(nonExecution.data()!, uid, articleId, requestId, replay);
  let op = (await ref.get()).data()!;
  if (op.state === 'completed') return withdrawalDto(op, articleId, uid, requestId, true);
  await redactReviewTitles(articleId, operationId);
  // Also revoke abandoned promoted variants in the article's server namespace.
  // A bounded incomplete listing never becomes a complete withdrawal receipt.
  if (!op.assetScanComplete) {
    try {
      const [files, next] = await storage.bucket().getFiles({ prefix: `articles/${articleId}/`, maxResults: 101, autoPaginate: false });
      await db.runTransaction(async tx => {
        const current = (await tx.get(ref)).data()!;
        if (current.operationId !== operationId) throw new HttpsError('failed-precondition', 'Intention incohérente.');
        const media: Media[] = [...current.media];
        for (const file of files.slice(0, 100)) if (!media.some(m => m.sourcePath === file.name)) {
          media.push({ mediaId: hash([articleId, file.name]), sourceUrl: null, sourcePath: file.name, sourceReferenceHashes: [],
            state: 'pending', reason: null, sourceGeneration: null, sourceCrc32c: null, size: null,
            contentType: null, privatePath: null, privateGeneration: null });
        }
        tx.update(ref, { media, assetScanComplete: !next?.pageToken && files.length <= 100,
          assetScanNeedsReview: !!next?.pageToken || files.length > 100, updatedAt: Timestamp.now() });
      });
    } catch (error) { logger.warn('article_privacy_asset_scan_pending', { articleId, operationId }); }
  }
  op = (await ref.get()).data()!;
  for (const media of op.media as Media[]) await preserveAndRevoke(articleId, operationId, media);
  await db.runTransaction(async tx => {
    const [currentSnap, articleSnap, items, promotions] = await Promise.all([tx.get(ref), tx.get(articleRef),
      tx.get(db.collection('swapPartyItems').where('articleId', '==', articleId).limit(201)),
      tx.get(db.collection('article_media_promotions').where('articleId', '==', articleId).limit(101))]);
    const current = currentSnap.data()!, article = articleSnap.data();
    if (current.operationId !== operationId || article?.privacyWithdrawal?.operationId !== operationId) {
      throw new HttpsError('failed-precondition', 'Retrait public à examiner.');
    }
    const media: Media[] = current.media;
    const promotionPending = promotions.size > 100 || promotions.docs.some(doc => {
      const permit = doc.data();
      return permit.schemaVersion !== 1 || permit.articleId !== articleId || permit.ownerId !== current.ownerId
        || typeof permit.destinationPath !== 'string' || !permit.destinationPath.startsWith(`articles/${articleId}/`)
        || !['ready', 'removed'].includes(permit.state);
    });
    const complete = current.contractCaptureComplete && current.publicProjectionScanComplete && current.assetScanComplete
      && !promotionPending && items.size <= 200 && media.every(m => m.state === 'revoked');
    const needsReview = !current.contractCaptureComplete || !current.publicProjectionScanComplete
      || current.assetScanNeedsReview || promotionPending || media.some(m => m.state === 'needs_review');
    const now = Timestamp.now();
    await assertFinancialRecoveryEffect('firestore_commit',{refs:[ref.path]});
    tx.set(articleRef, publicTombstone(article, article.privacyWithdrawal));
    tx.delete(db.collection('search_index').doc(articleId)); tx.delete(db.collection('embeddings').doc(articleId));
    for (const item of items.docs.slice(0, 200)) {
      // Do not erase an unpreserved overflow legacy projection on a retry.
      // It keeps the operation in needs_review until qualified privately.
      if (item.data().privacyWithdrawal?.operationId === operationId) tx.set(item.ref, partyTombstone(item.data(), article.privacyWithdrawal));
    }
    tx.update(ref, { state: complete ? 'completed' : needsReview ? 'needs_review' : 'pending', promotionPending,
      updatedAt: now, completedAt: complete ? current.completedAt ?? now : null });
  });
  return withdrawalDto((await ref.get()).data(), articleId, uid, requestId, replay);
  }));
}

export const withdrawArticlePrivacy = onCall(options, async request => withPrivateAccountSession(request, async () => {
  const {uid,articleId}=requestIdentity(request),{requestId,mode}=request.data??{};
  if(typeof requestId!=='string'||!/^[a-zA-Z0-9_-]{16,128}$/.test(requestId)||!['request','observe'].includes(mode))
    throw new HttpsError('invalid-argument','Intention et mode de retrait requis.');
  return executeArticleWithdrawal({uid,articleId,requestId,assertIntention:tx=>assertPrivateAccountSession(request,tx)},mode);
}));

/** Internal continuation from a native erasure intention. It is deliberately
 * not a fabricated callable/session and gives no permission to change money,
 * stock, frozen contracts or a different article owner. */
export async function withdrawArticleForAccountErasure(commandId:string,articleId:string){
  if(!/^[a-f0-9]{64}$/.test(commandId)||!validId(articleId))throw new HttpsError('invalid-argument','Référence interne invalide.');
  const workRef=db.collection('account_erasure_commands').doc(commandId);
  const command=(await workRef.get()).data(),existing=(await evidenceRef(articleId).get()).data();
  if(!command||command.protocol!=='account_erasure_v1'||command.commandId!==commandId||!validId(command.ownerId)||
    command.confirmed!==true||command.fenceCommitted!==true||!['erasing','auth_deletion_pending'].includes(command.state))
    throw new HttpsError('failed-precondition','Intention native d’effacement requise.');
  const uid=command.ownerId,requestId=existing?.requestId??commandId;
  return executeArticleWithdrawal({uid,articleId,requestId,assertIntention:async tx=>{
    const [job,profile,article]=await Promise.all([tx.get(workRef),tx.get(db.collection('eligibility_profiles').doc(uid)),
      tx.get(db.collection('articles').doc(articleId))]);
    if(job.data()?.inputHash!==command.inputHash||job.data()?.fenceCommitted!==true||
      profile.data()?.accountErasureFence?.commandId!==commandId||article.data()?.sellerId!==uid||
      (await privacyRetentionDecision(tx,uid,{category:'articles',id:articleId})).blocked)
      throw new HttpsError('failed-precondition','Source ou maintien de l’effacement modifié.');
  }},'request');
}

/** A checkout reservation is not an executed private contract. It may only
 * reuse its exact, still-public photos while that native reservation is current.
 * The caller keeps the Storage witness/token check and repeats this read after
 * external IO; withdrawal immediately removes this separate public permission. */
async function currentPublicReservation(uid: string, articleId: string, transactionId: string,
  op: FirebaseFirestore.DocumentData): Promise<FirebaseFirestore.DocumentData | null> {
  return db.runTransaction(async tx => {
    const [orderSnap, articleSnap, privacySnap] = await Promise.all([
      tx.get(db.collection('transactions').doc(transactionId)), tx.get(db.collection('articles').doc(articleId)), tx.get(evidenceRef(articleId)),
    ]);
    const order = orderSnap.data(), article = articleSnap.data();
    if (privacySnap.exists || !article || Object.prototype.hasOwnProperty.call(article, 'privacyWithdrawal')
        || article.sellerId !== op.ownerId || article.isActive !== true || article.isSold !== true
        || article.moderationStatus !== 'approved' || article.activeTransactionId !== transactionId
        || !order || order.deliveryType !== 'shipping' || order.status !== 'pending_payment' || order.paidAt != null
        || order.articleId !== articleId || order.sellerId !== op.ownerId || !validId(order.buyerId)
        || order.buyerId !== uid || order.buyerId === order.sellerId || order.currency !== 'CAD'
        || Object.prototype.hasOwnProperty.call(order, 'articlePrivacyWithdrawal')
        || !(order.createdAt instanceof Timestamp) || !(op.createdAt instanceof Timestamp)
        || order.createdAt.toMillis() > op.createdAt.toMillis()
        || !order.articleSnapshot || typeof order.articleSnapshot !== 'object' || Array.isArray(order.articleSnapshot)) return null;
    const references = (images: unknown): string[] | null => {
      if (!Array.isArray(images) || images.length < 1 || images.length > 10) return null;
      const urls = images.map(image => typeof image === 'string' ? image : image?.url);
      return urls.every(url => typeof url === 'string') ? urls : null;
    };
    const frozen = references(order.articleSnapshot.images), live = references(article.images);
    if (!frozen || !live || JSON.stringify(frozen) !== JSON.stringify(live)) return null;
    // No private media or historical dossier authority is created here.
    return { ...op, evidenceScope: 'public_reservation', contractId: transactionId,
      publicSourceSnapshot: { images: frozen }, media: [] };
  });
}

async function authorizeEvidence(uid: string, articleId: string, data: any, admin: boolean, allowUnrecorded = false): Promise<FirebaseFirestore.DocumentData> {
  const recorded = (await evidenceRef(articleId).get()).data();
  let op = recorded;
  if (!op) {
    if (!allowUnrecorded) throw new HttpsError('not-found', 'Preuve privée indisponible.');
    const article = (await db.collection('articles').doc(articleId).get()).data();
    if (!article || !validId(article.sellerId) || Object.prototype.hasOwnProperty.call(article, 'privacyWithdrawal')) {
      throw new HttpsError('failed-precondition', 'Absence de retrait non qualifiée.');
    }
    op = { ownerId: article.sellerId, articleId, state: 'unrecorded', createdAt: Timestamp.now(), publicSourceSnapshot: article };
  } else {
    if (op.schemaVersion !== 1 || op.articleId !== articleId) throw new HttpsError('failed-precondition', 'Preuve privée incohérente.');
    withdrawalDto(op, articleId, op.ownerId, op.requestId, true);
  }
  // Owner/operator permissions concern the full source dossier. A counterparty
  // instead receives a server-derived scope from ONE real frozen contract.
  if (op.ownerId === uid || admin) return { ...op, evidenceScope: 'owner_dossier', contractId: null };
  if (validId(data.transactionId)) {
    const order = await readNativeOrderAgreement(data.transactionId, op.createdAt, { viewerId: uid, sellerId: op.ownerId, articleId });
    if (!recorded && order && Object.prototype.hasOwnProperty.call(order, 'articlePrivacyWithdrawal')) {
      throw new HttpsError('failed-precondition', 'Preuve native de retrait manquante.');
    }
    if (order?.articleId === articleId && order.sellerId === op.ownerId && validId(order.buyerId)
        && order.buyerId !== order.sellerId && [order.buyerId, order.sellerId].includes(uid)
        && order.createdAt instanceof Timestamp && op.createdAt instanceof Timestamp) {
      return participantScope(op, order.articleSnapshot, 'transaction_contract', data.transactionId, recorded !== undefined);
    }
    if (!recorded) {
      const reservation = await currentPublicReservation(uid, articleId, data.transactionId, op);
      if (reservation) return reservation;
    }
    if (data.transactionId) throw new HttpsError('permission-denied', 'Commande non liée à cette preuve.');
  }
  if (validId(data.swapId)) {
    const swap = (await db.collection('swaps').doc(data.swapId).get()).data();
    if (!recorded && swap?.articlePrivacyWithdrawals && Object.prototype.hasOwnProperty.call(swap.articlePrivacyWithdrawals, articleId)) {
      throw new HttpsError('failed-precondition', 'Preuve native de retrait manquante.');
    }
    const items = swap ? [...(swap.initiatorItems ?? (swap.initiatorItem ? [swap.initiatorItem] : [])),
      ...(swap.receiverItems ?? (swap.receiverItem ? [swap.receiverItem] : []))] : [];
    if (swap && validId(swap.initiatorId) && validId(swap.receiverId) && swap.initiatorId !== swap.receiverId
        && [swap.initiatorId, swap.receiverId].includes(uid) && [swap.initiatorId, swap.receiverId].includes(op.ownerId)
        && items.some(i => i.articleId === articleId) && op.createdAt instanceof Timestamp
        && nativeSwapAgreement(swap, op.ownerId, op.createdAt, articleId)) {
      const ownerItems = swap.initiatorId === op.ownerId
        ? swap.initiatorItems ?? (swap.initiatorItem ? [swap.initiatorItem] : [])
        : swap.receiverItems ?? (swap.receiverItem ? [swap.receiverItem] : []);
      const exactItems = ownerItems.filter((item: any) => item.articleId === articleId);
      if (exactItems.length !== 1) throw new HttpsError('failed-precondition', 'Snapshot contractuel ambigu.');
      return participantScope(op, exactItems[0], 'swap_contract', data.swapId, recorded !== undefined);
    }
    if (data.swapId) throw new HttpsError('permission-denied', 'Échange non lié à cette preuve.');
  }
  throw new HttpsError('permission-denied', 'Cette preuve est réservée aux parties concernées.');
}

function snapshotReferenceHashes(snapshot: FirebaseFirestore.DocumentData): string[] {
  const images = [...(Array.isArray(snapshot.images) ? snapshot.images : []),
    ...(typeof snapshot.imageUrl === 'string' ? [snapshot.imageUrl] : [])];
  return [...new Set(images.map(image => typeof image === 'string' ? image : image?.url)
    .filter((url: unknown): url is string => typeof url === 'string').map(referenceHash))];
}
function participantScope(op: FirebaseFirestore.DocumentData, snapshot: FirebaseFirestore.DocumentData,
  evidenceScope: string, contractId: string, recorded: boolean) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) throw new HttpsError('failed-precondition', 'Snapshot contractuel non qualifié.');
  const nativeSnapshot = { ...snapshot };
  const nativeImageUrls = (Array.isArray(snapshot.images) ? snapshot.images : [])
    .map((image: any) => typeof image === 'string' ? image : image?.url).filter((url: unknown): url is string => typeof url === 'string');
  // acceptSwap overwrites images from the actual article, but legacy imageUrl
  // survives the proposer payload spread. It is only an alias if it matches
  // that authoritative array; never create private authority from its raw URI.
  if (!nativeImageUrls.includes(nativeSnapshot.imageUrl)) delete nativeSnapshot.imageUrl;
  const allowedSourceReferenceHashes = snapshotReferenceHashes(nativeSnapshot);
  const allowed = new Set(allowedSourceReferenceHashes);
  const media = recorded ? (op.media as Media[]).flatMap(m => {
    // Published article objects are server-only and immutable. A legacy staged
    // reference can have been overwritten since this contract; never expose its
    // latest pixels as the party's historical private image.
    if (!m.sourcePath?.startsWith(`articles/${op.articleId}/`)) return [];
    const sourceReferenceHashes = m.sourceReferenceHashes.filter(hash => allowed.has(hash));
    return sourceReferenceHashes.length ? [{ ...m, sourceReferenceHashes }] : [];
  }) : [];
  return { ...op, evidenceScope, contractId, sourceSnapshot: nativeSnapshot, publicSourceSnapshot: nativeSnapshot,
    sourceUpdatedAt: null, media, allowedSourceReferenceHashes };
}

export const readPrivateArticleEvidence = onCall(options, async request => {
  return withPrivateAccountSession(request, async () => {
  const { uid, articleId } = requestIdentity(request);
  const op = await authorizeEvidence(uid, articleId, request.data, (await assertPrivateAccountSession(request)).currentAdminClaim, true);
  const requestedHashes = request.data.sourceReferenceHashes ?? [];
  if (!Array.isArray(requestedHashes) || requestedHashes.length > 10
      || requestedHashes.some((value: unknown) => typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))) {
    throw new HttpsError('invalid-argument', 'Empreintes source invalides.');
  }
  if (op.state === 'unrecorded') {
    const publicReferenceHashes = new Set<string>();
    const tokenlessSources = new Map<string, { path: string; witness: PrivateImageWitness }>();
    const nativeImages = [...(Array.isArray(op.publicSourceSnapshot?.images) ? op.publicSourceSnapshot.images : []),
      ...(typeof op.publicSourceSnapshot?.imageUrl === 'string' ? [op.publicSourceSnapshot.imageUrl] : [])];
    const nativeReferences = new Set<string>(nativeImages.map(image => typeof image === 'string' ? image : image?.url)
      .filter((url: unknown): url is string => typeof url === 'string'));
    for (const url of nativeReferences) {
      if (!requestedHashes.includes(referenceHash(url))) continue;
      const path = storageObjectPath(url, storage.bucket().name);
      if (!path?.startsWith(`articles/${articleId}/`)) continue;
      try {
        const [metadata] = await storage.bucket().file(path).getMetadata();
        const witness = sourceImageWitness(metadata);
        const token = new URL(url).searchParams.get('token');
        if (token) {
          if (!String(metadata.metadata?.firebaseStorageDownloadTokens ?? '').split(',').includes(token)) continue;
        } else {
          // New article originals deliberately have no bearer token. This is
          // only their existing public Storage reference, not private media:
          // rules already permit it while the withdrawal marker is absent.
          const canonical = `https://firebasestorage.googleapis.com/v0/b/${storage.bucket().name}/o/${encodeURIComponent(path)}?alt=media`;
          if (url !== canonical) continue;
          tokenlessSources.set(referenceHash(url), { path, witness });
        }
        publicReferenceHashes.add(referenceHash(url));
      } catch { /* An unknown/missing source never permits a public fallback. */ }
    }
    // Do not qualify an object replaced during the read. The native absence of
    // withdrawal is rechecked below AFTER this final external I/O as well.
    const changedTokenless = new Set<string>();
    for (const [reference, source] of tokenlessSources) {
      try {
        const [metadata] = await storage.bucket().file(source.path).getMetadata();
        const current = sourceImageWitness(metadata);
        if (current.sourceGeneration !== source.witness.sourceGeneration || current.sourceCrc32c !== source.witness.sourceCrc32c
            || current.contentType !== source.witness.contentType || current.size !== source.witness.size) changedTokenless.add(reference);
      } catch { changedTokenless.add(reference); }
    }
    // Privacy command and projection write can race the metadata GET. Re-read
    // its native absence before returning a narrowly scoped public reference.
    const current = await authorizeEvidence(uid, articleId, request.data, (await assertPrivateAccountSession(request)).currentAdminClaim, true);
    if (current.state !== 'unrecorded') throw new HttpsError('failed-precondition', 'Retrait enregistré pendant cette lecture.');
    const currentImages = [...(Array.isArray(current.publicSourceSnapshot?.images) ? current.publicSourceSnapshot.images : []),
      ...(typeof current.publicSourceSnapshot?.imageUrl === 'string' ? [current.publicSourceSnapshot.imageUrl] : [])];
    const stillNative = new Set(currentImages
      .map((image: any) => typeof image === 'string' ? image : image?.url).filter((url: unknown): url is string => typeof url === 'string').map(referenceHash));
    const qualifiedHashes = [...publicReferenceHashes].filter(value => stillNative.has(value) && !changedTokenless.has(value));
    return { kind: 'private_article_evidence_v1', state: 'unrecorded',
    viewerId: uid, ownerId: op.ownerId, articleId, evidenceId: null, capturedAt: null, sourceUpdatedAt: null, snapshot: null,
    mediaRefs: [], mediaNeedsReview: 0, ownerWithdrawalAttempt: null,
    publicReferenceUseAllowed: qualifiedHashes.length > 0, publicReferenceHashes: qualifiedHashes };
  }
  const source = op.sourceSnapshot;
  const fields = ['title', 'description', 'price', 'categoryIds', 'condition', 'brand', 'brandStatus', 'size',
    'hasKnownDefects', 'defectsDescription', 'hasAlterations', 'alterationsDescription', 'hygieneDeclaration'];
  const snapshot: Record<string, unknown> = {};
  for (const field of fields) if (field in source) snapshot[field] = source[field];
  return { kind: 'private_article_evidence_v1', state: 'recorded', publicReferenceUseAllowed: false, publicReferenceHashes: [],
    viewerId: uid, ownerId: op.ownerId, articleId, evidenceId: op.operationId,
    ownerWithdrawalAttempt: uid === op.ownerId ? { version: 1, ownerId: op.ownerId, articleId, requestId: op.requestId } : null,
    capturedAt: iso(op.createdAt), sourceUpdatedAt: iso(op.sourceUpdatedAt), snapshot,
    evidenceScope: op.evidenceScope, contractId: op.contractId,
    mediaRefs: (op.media as Media[]).filter(m => m.sourceReferenceHashes.length && m.privateGeneration && m.privatePath)
      .flatMap(m => m.sourceReferenceHashes.map(sourceReferenceHash => ({ mediaId: m.mediaId, sourceReferenceHash,
      evidenceId: op.operationId, contentType: m.contentType, size: m.size, generation: m.privateGeneration,
      mediaBasis: 'source_generation_at_withdrawal', historicalPixelsVerified: false }))),
    mediaNeedsReview: op.evidenceScope === 'owner_dossier' ? (op.media as Media[]).filter(m => !m.privateGeneration).length
      : (op.allowedSourceReferenceHashes as string[]).filter(hash => !(op.media as Media[]).some(m => m.privateGeneration && m.sourceReferenceHashes.includes(hash))).length };

  });
});

export const readPrivateArticleMedia = onCall(options, async request => {
  return withPrivateAccountSession(request, async () => {
  const { uid, articleId } = requestIdentity(request);
  const op = await authorizeEvidence(uid, articleId, request.data, (await assertPrivateAccountSession(request)).currentAdminClaim);
  if (request.data.evidenceId !== op.operationId || !/^[a-f0-9]{64}$/.test(request.data.mediaId ?? '')) {
    throw new HttpsError('invalid-argument', 'Référence privée invalide.');
  }
  const media = (op.media as Media[]).find(m => m.mediaId === request.data.mediaId);
  const sourceReferenceHash = request.data.sourceReferenceHash ?? media?.sourceReferenceHashes[0];
  if (typeof sourceReferenceHash !== 'string' || !media?.sourceReferenceHashes.includes(sourceReferenceHash)) {
    throw new HttpsError('invalid-argument', 'Référence source non liée à cette copie.');
  }
  const expectedPath = `article_privacy/${articleId}/${op.operationId}/${request.data.mediaId}`;
  if (!media?.privateGeneration || media.privatePath !== expectedPath) throw new HttpsError('failed-precondition', 'Copie privée non qualifiée.');
  const bytes = await readPrivateImage(expectedPath, media as PrivateImageWitness, op.operationId, media.mediaId);
  // Re-check identity relationship after IO; no signed/public download URL.
  const after = await authorizeEvidence(uid, articleId, request.data, (await assertPrivateAccountSession(request)).currentAdminClaim);
  const stillAllowed = (after.media as Media[]).find(m => m.mediaId === media.mediaId && m.sourceReferenceHashes.includes(sourceReferenceHash));
  if (after.operationId !== op.operationId || after.evidenceScope !== op.evidenceScope || after.contractId !== op.contractId
      || !stillAllowed || stillAllowed.privateGeneration !== media.privateGeneration
      || stillAllowed.sourceGeneration !== media.sourceGeneration || stillAllowed.sourceCrc32c !== media.sourceCrc32c
      || stillAllowed.privatePath !== media.privatePath || stillAllowed.size !== media.size || stillAllowed.contentType !== media.contentType) {
    throw new HttpsError('permission-denied', 'La copie ne relève plus de ce contrat.');
  }
  return { kind: 'private_article_media_v1', viewerId: uid, articleId, evidenceId: op.operationId,
    mediaId: media.mediaId, sourceReferenceHash, generation: media.privateGeneration, contentType: media.contentType, size: bytes.length,
    mediaBasis: 'source_generation_at_withdrawal', historicalPixelsVerified: false,
    dataUrl: `data:${media.contentType};base64,${bytes.toString('base64')}` };

  });
});
