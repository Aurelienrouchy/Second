/** An explicit owner publication intent, separate from an admission decision.
 * Own receipts prove their joint commit, never the listing's current visibility. */
import { Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { db } from '../config/firebase';
import { articlePrivacyWithdrawn } from './publicProfile';
import { readArticleChildSafetySource, isChildSafetyPreparationEditable } from './articleChildSafety';
import { readProductReviewAdmission } from './productReviewAdmission';
import { readEligibilityEvidence } from './eligibility';
import { assertOwnTradingEligibility } from './tradeAdmission';
import { assertArticleHygieneAdmitted } from './articleHygiene';
import { assertArticleSaleDeclaration } from './articleSaleDeclaration';
import { prepareOperationalNotices, readOperationalNoticeReceipt } from './notifications';
import { supportHash, supportId, supportObject, supportRequestId, supportUid } from './supportRequest';

export const CHILD_PUBLICATION_CAPABILITY = 'article_child_safety_publication_v1';
export const CHILD_PUBLICATION_BLOCKERS = ['preparation_unqualified', 'privacy_withdrawn', 'preparation_withdrawn',
  'other_moderation', 'agreement_or_inventory_review', 'seller_admission_required', 'hygiene_declaration_required',
  'sale_declaration_required', 'shop_unqualified', 'images_unqualified', 'child_admission_unqualified'] as const;
export const CHILD_PUBLICATION_REASONS = ['requester_neutralized', 'publication_source_unavailable',
  'publication_context_not_authorized', 'publication_source_changed', 'publication_guarded'] as const;
type Command = { articleId: string; articleRevision: string; childSourceHash: string; admissionDecisionId: string; acknowledged: true };
type Dependencies = {
  assertNoLiveArticleTransaction: (tx: FirebaseFirestore.Transaction, articleId: string, article: FirebaseFirestore.DocumentData) => Promise<void>;
  assertArticleEditable: (tx: FirebaseFirestore.Transaction, articleId: string, uid: string) => Promise<FirebaseFirestore.DocumentData>;
};
const HASH = /^[a-f0-9]{64}$/;
const nativeTime = (v: unknown): v is Timestamp => v instanceof Timestamp && v.toMillis() > 0 && v.toMillis() <= Date.now();
function revision(snap: FirebaseFirestore.DocumentSnapshot): string | null {
  const at = snap.updateTime;
  return snap.exists && at && Number.isSafeInteger(at.seconds) && at.seconds > 0 && Number.isInteger(at.nanoseconds) && at.nanoseconds >= 0 && at.nanoseconds < 1_000_000_000
    ? supportHash([snap.id, snap.data()?.sellerId ?? null, at.seconds, at.nanoseconds]) : null;
}
function commandInput(raw: unknown): Command {
  const c = supportObject(raw, ['articleId', 'articleRevision', 'childSourceHash', 'admissionDecisionId', 'acknowledged']);
  if (!HASH.test(c.articleRevision ?? '') || !HASH.test(c.childSourceHash ?? '') || typeof c.admissionDecisionId !== 'string' ||
      !/^pa_[a-f0-9]{64}$/.test(c.admissionDecisionId) || c.acknowledged !== true) throw new HttpsError('invalid-argument', 'Source actuelle et confirmation explicite de publication requises.');
  return {articleId: supportId(c.articleId, 'Annonce'), articleRevision: c.articleRevision, childSourceHash: c.childSourceHash,
    admissionDecisionId: c.admissionDecisionId, acknowledged: true};
}
const commandId = (uid: string, requestId: string) => 'cp_' + supportHash([uid, requestId]);
const commandRef = (uid: string, requestId: string) => db.collection('article_child_publication_commands').doc(supportHash([uid, requestId]));
function notice(uid: string, id: string, command: Command) {
  return {eventKey: `article_child_publication_v1:${id}`, userId: uid, type: 'article_moderation', title: 'Publication enregistrée',
    message: 'La publication de cette préparation a été enregistrée. Consultez l’annonce pour son état actuel. Cette décision ne certifie pas la conformité physique du produit.',
    data: {ownerId: uid, articleId: command.articleId, childPublicationCommandId: id}};
}
async function qualify(tx: FirebaseFirestore.Transaction, uid: string, snap: FirebaseFirestore.DocumentSnapshot, dependencies: Dependencies) {
  const article = snap.data()!, source = readArticleChildSafetySource(snap.id, article), blockers: string[] = [];
  if (articlePrivacyWithdrawn(article)) blockers.push('privacy_withdrawn');
  if (article.childSafetyPreparation?.state === 'withdrawn') blockers.push('preparation_withdrawn');
  if (!isChildSafetyPreparationEditable(snap.id, article) || source.requirement !== 'human_review_required') blockers.push('preparation_unqualified');
  // First preparations have no independent moderation history. Its presence is
  // not permission to override that history using this separate owner gesture.
  if ((await tx.get(db.collection('article_moderation').doc(snap.id))).exists) blockers.push('other_moderation');
  const guard = async (fn: () => void | Promise<void>, blocker: string) => {
    try {await fn();} catch (error) {if (!(error instanceof HttpsError)) throw error; blockers.push(blocker);}
  };
  if (article.isSold !== false) blockers.push('agreement_or_inventory_review');
  await guard(() => dependencies.assertNoLiveArticleTransaction(tx, snap.id, article), 'agreement_or_inventory_review');
  const evidence = await readEligibilityEvidence(tx, uid);
  await guard(async () => await assertOwnTradingEligibility(evidence, 'sell', tx, uid), 'seller_admission_required');
  await guard(() => assertArticleHygieneAdmitted(article), 'hygiene_declaration_required');
  await guard(() => assertArticleSaleDeclaration(snap.id, article), 'sale_declaration_required');
  if (!Array.isArray(article.images) || article.images.length === 0 || article.images.length > 10 || article.images.some((image: any) => {
    const url = typeof image === 'string' ? image : image?.url; return typeof url !== 'string' || !url.trim();
  })) blockers.push('images_unqualified');
  const shops = await tx.get(db.collection('shops').where('ownerId', '==', uid).limit(101));
  if (shops.size >= 101 || shops.docs.some(row => !['approved', 'pending', 'rejected'].includes(row.data().status))) blockers.push('shop_unqualified');
  if (article.shopId != null) {
    if (typeof article.shopId !== 'string' || !article.shopId || article.shopId.includes('/')) blockers.push('shop_unqualified');
    else {
      const shop = (await tx.get(db.collection('shops').doc(article.shopId))).data();
      if (!shop || shop.ownerId !== uid || shop.status !== 'approved') blockers.push('shop_unqualified');
    }
  }
  const admission = await readProductReviewAdmission(tx, snap.id, article);
  if (!admission.allowed || admission.qualification !== 'native_current_allow' || admission.currentSourceHash !== source.sourceHash ||
      typeof admission.decisionId !== 'string' || !/^pa_[a-f0-9]{64}$/.test(admission.decisionId)) blockers.push('child_admission_unqualified');
  return {article, source, articleRevision: revision(snap), admission, blockers: [...new Set(blockers)]};
}
function receiptView(uid: string, requestId: string, command: Command, data?: FirebaseFirestore.DocumentData) {
  return {protocol: 'article_child_safety_publication_command_v1' as const, ownerId: uid, requestId, commandId: commandId(uid, requestId),
    command, payloadHash: supportHash(command), state: data?.state ?? 'unrecorded', reason: data?.reason ?? null, blockers: data?.blockers ?? [],
    recordedAt: data ? data.recordedAt.toDate().toISOString() : null,
    publicationRecorded: data?.state === 'committed', listingActivatedAtCommit: data?.state === 'committed',
    currentPublicationVerified: false, sourceAfterReceiptMustBeRead: true, physicalComplianceVerified: false,
    platformCertificationGranted: false, financialEffectsAuthorized: false, inventoryReleaseAuthorized: false,
    notificationCommitted: data?.state === 'committed', deviceDeliveryVerified: false, readingVerified: false};
}
export async function handleArticleChildSafetyPublication(request: any, dependencies: Dependencies) {
  const uid = supportUid(request), raw = request.data;
  if (raw.mode !== 'child_safety_publication' || raw.capability !== CHILD_PUBLICATION_CAPABILITY) throw new HttpsError('invalid-argument', 'Version de publication explicite requise.');
  if (raw.action === 'preview') {
    const input = supportObject(raw, ['mode', 'capability', 'expectedUid', 'action', 'articleId']), articleId = supportId(input.articleId, 'Annonce');
    return db.runTransaction(async tx => {
      const snap = await tx.get(db.collection('articles').doc(articleId));
      if (!snap.exists || snap.data()?.sellerId !== uid) throw new HttpsError('permission-denied', 'Préparation non autorisée.');
      const state = await qualify(tx, uid, snap, dependencies), canPublishNow = state.blockers.length === 0 && state.articleRevision !== null;
      const preparationCurrent = isChildSafetyPreparationEditable(articleId, state.article);
      let canCorrectPreparationNow = false;
      // The edit admission itself is re-used, not reconstructed from pending,
      // dates or publication/admission blockers. Content-specific statements
      // are still checked by updateArticle for the actual proposed edit.
      if (preparationCurrent) {
        try {await dependencies.assertArticleEditable(tx, articleId, uid); canCorrectPreparationNow = true;}
        catch (error) {if (!(error instanceof HttpsError)) throw error;}
      }
      // Standalone withdrawal deliberately has no new seller/admission gate.
      // These are precisely the native preparation + privacy/reservation
      // checks whose mutation records state withdrawn in updateArticle.
      const canWithdrawPreparationNow = preparationCurrent && !articlePrivacyWithdrawn(state.article) &&
        !state.blockers.includes('agreement_or_inventory_review');
      return {protocol: 'article_child_safety_publication_preview_v1', ownerId: uid, articleId, source: state.source,
        articleRevision: state.articleRevision, admissionQualification: state.admission.qualification, blockers: state.blockers,
        canPublishNow, canCorrectPreparationNow, canWithdrawPreparationNow, acknowledgmentRequired: true, commandSource: canPublishNow ? {articleId, articleRevision: state.articleRevision,
          childSourceHash: state.source.sourceHash, admissionDecisionId: state.admission.decisionId} : null,
        currentPublicationVerified: false, physicalComplianceVerified: false, platformCertificationGranted: false,
        financialEffectsAuthorized: false, inventoryReleaseAuthorized: false};
    });
  }
  const input = supportObject(raw, ['mode', 'capability', 'expectedUid', 'action', 'requestId', 'command']);
  if (!['execute', 'observe', 'neutralize'].includes(input.action)) throw new HttpsError('invalid-argument', 'Action du journal invalide.');
  const requestId = supportRequestId(input.requestId), command = commandInput(input.command), payloadHash = supportHash(command), id = commandId(uid, requestId), ref = commandRef(uid, requestId);
  return db.runTransaction(async tx => {
    const prior = (await tx.get(ref)).data();
    // No current article, admission, profile or Auth cutoff is required to read
    // this owner's immutable exact result. A replay cannot reapply visibility.
    if (prior) {
      if (prior.protocol !== 'article_child_safety_publication_command_v1' || prior.ownerId !== uid || prior.requestId !== requestId || prior.commandId !== id ||
          prior.payloadHash !== payloadHash || supportHash(prior.command) !== payloadHash || !nativeTime(prior.recordedAt) || !['committed', 'not_executed'].includes(prior.state) ||
          !Array.isArray(prior.blockers) || prior.blockers.some((b: unknown) => !(CHILD_PUBLICATION_BLOCKERS as readonly unknown[]).includes(b))) throw new HttpsError('already-exists', 'Cette intention désigne une autre publication ou un reçu inconnu.');
      if (prior.state === 'committed') {
        const effect = prior.effect;
        if (prior.reason !== null || prior.blockers.length || effect?.protocol !== 'article_child_safety_publication_effect_v1' || effect.commandId !== id ||
            effect.ownerId !== uid || effect.articleId !== command.articleId || effect.articleRevisionBefore !== command.articleRevision || effect.childSourceHash !== command.childSourceHash ||
            effect.admissionDecisionId !== command.admissionDecisionId || !nativeTime(effect.publishedAt) || !effect.publishedAt.isEqual(prior.recordedAt) ||
            prior.effectHash !== supportHash(effect)) throw new HttpsError('unavailable', 'La preuve native de publication doit être rapprochée.');
        const notification = await readOperationalNoticeReceipt(tx, notice(uid, id, command));
        if (!notification || prior.notificationId !== notification.notificationId) throw new HttpsError('unavailable', 'Le reçu de l’avis doit être rapproché.');
      } else if (!(CHILD_PUBLICATION_REASONS as readonly unknown[]).includes(prior.reason) || prior.effect !== null || prior.effectHash !== null || prior.notificationId !== null)
        throw new HttpsError('unavailable', 'La non-exécution native doit être rapprochée.');
      return receiptView(uid, requestId, command, prior);
    }
    if (input.action === 'observe') return receiptView(uid, requestId, command);
    const now = Timestamp.now();
    const noEffect = (reason: typeof CHILD_PUBLICATION_REASONS[number], blockers: string[] = []) => {
      const value = {protocol: 'article_child_safety_publication_command_v1', ownerId: uid, requestId, commandId: id, command, payloadHash,
        state: 'not_executed', reason, blockers, recordedAt: now, effect: null, effectHash: null, notificationId: null};
      tx.create(ref, value); return receiptView(uid, requestId, command, value);
    };
    if (input.action === 'neutralize') return noEffect('requester_neutralized');
    const articleRef = db.collection('articles').doc(command.articleId), snap = await tx.get(articleRef);
    if (!snap.exists) return noEffect('publication_source_unavailable');
    if (snap.data()?.sellerId !== uid) return noEffect('publication_context_not_authorized');
    const source = readArticleChildSafetySource(command.articleId, snap.data()!);
    if (revision(snap) !== command.articleRevision || source.sourceHash !== command.childSourceHash) return noEffect('publication_source_changed');
    const state = await qualify(tx, uid, snap, dependencies);
    if (state.admission.decisionId !== command.admissionDecisionId) return noEffect('publication_source_changed');
    if (state.blockers.length) return noEffect('publication_guarded', state.blockers);
    const notices = await prepareOperationalNotices(tx, [notice(uid, id, command)]);
    const effect = {protocol: 'article_child_safety_publication_effect_v1', commandId: id, ownerId: uid, articleId: command.articleId,
      articleRevisionBefore: command.articleRevision, childSourceHash: command.childSourceHash, admissionDecisionId: command.admissionDecisionId, publishedAt: now};
    const value = {protocol: 'article_child_safety_publication_command_v1', ownerId: uid, requestId, commandId: id, command, payloadHash,
      state: 'committed', reason: null, blockers: [], recordedAt: now, effect, effectHash: supportHash(effect), notificationId: notices.notificationIds[0]};
    tx.update(articleRef, {isActive: true, moderationStatus: 'approved', moderationSource: 'child_safety_admission_publication', childSafetyPublication: effect, updatedAt: now});
    tx.create(ref, value); notices.commit(); return receiptView(uid, requestId, command, value);
  });
}
