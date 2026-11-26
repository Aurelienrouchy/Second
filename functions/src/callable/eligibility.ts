import {assertPrivateAccountSession, withPrivateAccountSession} from '../utils/privateAccountSession';
/** Owner/admin foundations only. No financial/provider/public-profile writes. */
import { createHash } from 'node:crypto';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db, FieldValue } from '../config/firebase';
import { ageFromIsoDate, civilDateAfterDays, quebecCivilDate } from '../shared/age';
import { ELIGIBILITY_POLICY_VERSION, ELIGIBILITY_SCOPES, eligibilityVersion, hasPersistedDateOfBirth, dateOfBirthCopy, dateOfBirthIdentity, dateOfBirthHasReference,
  type EligibilityScope } from '../shared/eligibility';
import { ELIGIBILITY_COLLECTIONS as C, adminSignalsDto, ownerEligibilityDto, ownerReviewDto, readEligibilityEvidence,
  sellerActivityReceiptDto,
  readSellerActivityHistory, readSellerActivitySales, readSellerActivitySwaps } from '../utils/eligibility';

import {SELLER_ACTIVITY_REVIEW_CAPABILITY, handleSellerActivityReview, isSellerActivityReview, sellerActivityAdminReviewDto,
  sellerActivityReviewNotice} from '../utils/sellerActivityReview';
import {nextEligibilityProfile as nextProfile, prepareSellerActivityDeclaration} from '../utils/sellerActivityDeclaration';
import {prepareOperationalNotices, readOperationalNoticeReceipt} from '../utils/notifications';

const OPTIONS = { region: 'northamerica-northeast1', memory: '512MiB' as const };
const key = (...parts: string[]) => createHash('sha256').update(JSON.stringify(parts)).digest('hex');
const payloadHash = (data: Record<string, any>) => key(JSON.stringify(Object.fromEntries(Object.keys(data).sort().map(k => [k, data[k]]))));
const stamp = () => FieldValue.serverTimestamp();
function authUid(request: any): string {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentification requise.');
  return request.auth.uid;
}
async function adminUid(request: any): Promise<string> {
  const uid = authUid(request);
  const session = await assertPrivateAccountSession(request), user = (await db.collection('users').doc(uid).get()).data();
  if (user && Object.prototype.hasOwnProperty.call(user, 'isActive') && user.isActive !== true ||
      !session.currentAdminClaim && user?.isAdmin !== true) {
    throw new HttpsError('permission-denied', 'Accès administrateur requis.');
  }
  return uid;
}
async function recheckAdmin(tx: FirebaseFirestore.Transaction, request: any, uid: string) {
  const session = await assertPrivateAccountSession(request, tx), user = (await tx.get(db.collection('users').doc(uid))).data();
  if (user && Object.prototype.hasOwnProperty.call(user, 'isActive') && user.isActive !== true ||
      !session.currentAdminClaim && user?.isAdmin !== true) {
    throw new HttpsError('permission-denied', 'Accès administrateur requis.');
  }
}
function input(value: unknown, keys: string[]): Record<string, any> {
  if (value == null) return {};
  if (typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k))) throw new HttpsError('invalid-argument', 'Paramètres invalides.');
  return value as Record<string, any>;
}
function text(value: unknown, name: string, max = 2000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new HttpsError('invalid-argument', `${name} requis ou invalide.`);
  return value.trim();
}
function identifier(value: unknown, name = 'Identifiant'): string {
  const id = text(value, name, 128);
  if (id.includes('/') || id === '.' || id === '..') throw new HttpsError('invalid-argument', `${name} invalide.`);
  return id;
}
function scopeOf(value: unknown): EligibilityScope {
  if (!(ELIGIBILITY_SCOPES as readonly unknown[]).includes(value)) throw new HttpsError('invalid-argument', 'Périmètre invalide.');
  return value as EligibilityScope;
}
function expectVersion(value: unknown, evidence: Parameters<typeof eligibilityVersion>[0]) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new HttpsError('invalid-argument', 'Version attendue requise.');
  if (eligibilityVersion(evidence) !== value) throw new HttpsError('aborted', 'Vos renseignements ont changé. Actualisez-les avant de poursuivre.');
}
function expectRequestVersion(value: unknown, data: any) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new HttpsError('invalid-argument', 'Version de demande requise.');
  if (data.version !== value) throw new HttpsError('aborted', 'La demande a changé. Actualisez-la avant de décider.');
}
function proofDob(value: unknown): string {
  if (typeof value !== 'string' || ageFromIsoDate(value) === null) throw new HttpsError('invalid-argument', 'Date de naissance réelle, non future, au format YYYY-MM-DD requise.');
  return value;
}
const existingDob = hasPersistedDateOfBirth;
function operationRef(actor: string, requestId: string) { return db.collection(C.audit).doc(key(actor, requestId)); }
function replay(data: any, action: string, hash: string): data is FirebaseFirestore.DocumentData {
  if (!data) return false;
  if (data.action !== action || data.inputHash !== hash) throw new HttpsError('already-exists', 'Cet identifiant a déjà été utilisé pour une autre opération.');
  return true;
}
function audit(tx: FirebaseFirestore.Transaction, ref: FirebaseFirestore.DocumentReference, action: string, hash: string,
  actor: string, owner: string, details: Record<string, unknown>) {
  tx.set(ref, { action, inputHash: hash, actorUid: actor, ownerId: owner, policyVersion: ELIGIBILITY_POLICY_VERSION,
    createdAt: stamp(), ...details });
}
function activeReviewPatch(profile: any, id: string, kind: string, scope: EligibilityScope, active: boolean) {
  const reviews = { ...(profile?.activeReviews ?? {}), [id]: { scope, active } };
  if (kind === 'date_of_birth_correction') reviews[id + '_sell'] = { scope: 'sell', active };
  return reviews;
}

export const getMyEligibility = onCall(OPTIONS, async request => {
  return withPrivateAccountSession(request, async () => {
  const uid = authUid(request);
  if (request.data?.operation === 'seller_activity_history') {
    const data = input(request.data, ['operation','expectedUid','cursor','relatedSalesCursor','initiatedSwapsCursor','receivedSwapsCursor']);
    if (data.expectedUid !== uid) throw new HttpsError('permission-denied','Le compte connecté a changé.');
    const cursor = (value: unknown) => value == null ? null : identifier(value,'Curseur');
    return db.runTransaction(async tx => {
      await assertPrivateAccountSession(request,tx);
      return {protocol:'seller_activity_history_page_v1',
        history:await readSellerActivityHistory(tx,uid,cursor(data.cursor)),
        relatedSales:await readSellerActivitySales(tx,uid,cursor(data.relatedSalesCursor)),
        relatedSwaps:await readSellerActivitySwaps(tx,uid,cursor(data.initiatedSwapsCursor),cursor(data.receivedSwapsCursor)),
        currentEligibility:ownerEligibilityDto(await readEligibilityEvidence(tx,uid))};
    });
  }
  if (request.data?.operation === 'swap_proposal_preview' || request.data?.operation === 'swap_exchange_preview') {
    const data = input(request.data, ['operation', 'expectedUid', 'swapId', 'receiverId', 'initiatorArticleIds', 'receiverArticleIds',
      'exchangeMode', 'arrangements', 'cashTopUp', 'message']);
    const { readSwapAgreementPreview } = await import('./swaps');
    return db.runTransaction(async tx => {
      await assertPrivateAccountSession(request, tx);
      return { swapProposalPreview: await readSwapAgreementPreview(tx, uid, data) };
    });
  }
  input(request.data, []);
  return db.runTransaction(async tx => {
    await assertPrivateAccountSession(request, tx);
    return ownerEligibilityDto(await readEligibilityEvidence(tx, uid));
  });

  });
});

export const declareSellerActivity = onCall(OPTIONS, async request => {
  return withPrivateAccountSession(request, async () => {
  const uid = authUid(request);
  const data = input(request.data, ['kind', 'statementVersion', 'personalDeclarationAccepted', 'expectedVersion', 'requestId', 'quebecResidenceDeclaration', 'expectedUid']);
  const residence = data.quebecResidenceDeclaration;
  if (('expectedUid' in data || residence != null) && data.expectedUid !== uid) throw new HttpsError('permission-denied',
    'La session de déclaration a changé. Relisez la déclaration avec le compte connecté.', { reason: 'swap_session_changed' });
  const requestId = identifier(data.requestId), hash = payloadHash(data), ref = operationRef(uid, requestId);
  return db.runTransaction(async tx => {
    await assertPrivateAccountSession(request, tx);
    const op = (await tx.get(ref)).data();
    const evidence = await readEligibilityEvidence(tx, uid);
    if (replay(op, 'declare_activity', hash)) {
      const currentEligibility = ownerEligibilityDto(evidence);
      return {recorded:true,alreadyRecorded:true,declarationReceipt:sellerActivityReceiptDto(ref.id,op,uid),
        eligibility:currentEligibility,currentEligibility};
    }
    // Historical replay above precedes today's statement/CAS validation.
    const {event, profile} = await prepareSellerActivityDeclaration(tx, uid, data, evidence);
    tx.set(db.collection(C.profiles).doc(uid), profile);
    tx.create(ref,event);
    const currentEligibility=ownerEligibilityDto({...evidence,profile});
    return {recorded:true,alreadyRecorded:false,declarationReceipt:sellerActivityReceiptDto(ref.id,event,uid),
      eligibility:currentEligibility,currentEligibility};
  });

  });
});

export const requestEligibilityReview = onCall(OPTIONS, async request => {
  return withPrivateAccountSession(request, async () => {
  const uid = authUid(request);
  const data = input(request.data, ['kind', 'scope', 'proposedDateOfBirth', 'reason', 'expectedVersion', 'requestId', 'priorReviewId']);
  if (!['review', 'date_of_birth_correction'].includes(data.kind)) throw new HttpsError('invalid-argument', 'Type de demande invalide.');
  const scope = data.kind === 'date_of_birth_correction' ? 'buy' : scopeOf(data.scope);
  const proposed = data.kind === 'date_of_birth_correction' ? proofDob(data.proposedDateOfBirth) : null;
  if (data.kind === 'review' && data.proposedDateOfBirth != null) throw new HttpsError('invalid-argument', 'Utilisez la demande distincte de correction de naissance.');
  const reason = text(data.reason, 'Motif'), requestId = identifier(data.requestId);
  const priorId = data.priorReviewId == null ? null : identifier(data.priorReviewId);
  const id = 'review_' + key(uid, requestId), ref = db.collection(C.requests).doc(id);
  const hash = payloadHash(data), opRef = operationRef(uid, requestId);
  const receivedAtMs = Date.now(), receivedCivilDate = quebecCivilDate(new Date(receivedAtMs))!;
  return db.runTransaction(async tx => {
    await assertPrivateAccountSession(request, tx);
    const op = (await tx.get(opRef)).data();
    const previous = (await tx.get(ref)).data();
    const prior = priorId ? (await tx.get(db.collection(C.requests).doc(priorId))).data() : null;
    const evidence = await readEligibilityEvidence(tx, uid);
    if (!evidence.user) throw new HttpsError('failed-precondition', 'Complétez votre inscription.');
    if (replay(op, 'request_review', hash)) {
      const notice = op.ownerNotice ? await readOperationalNoticeReceipt(tx, op.ownerNotice) : null;
      if (op.ownerNotice && !notice) throw new HttpsError('failed-precondition', 'La preuve de notification manque.');
      return { recorded: true, alreadyRecorded: true, request: ownerReviewDto(id, previous!), eligibility: ownerEligibilityDto(evidence),
        ...(notice ? {notice} : {}) };
    }
    expectVersion(data.expectedVersion, evidence);
    if (data.kind === 'date_of_birth_correction' && !existingDob(evidence.user)) throw new HttpsError('failed-precondition',
      'La première date doit passer par recordSignupConsent avec les conditions générales et la confidentialité acceptées.');
    if (data.kind === 'date_of_birth_correction' && dateOfBirthHasReference(evidence.user.dateOfBirth) && !evidence.nativeSourceDocumentVersion) {
      throw new HttpsError('failed-precondition', 'La version de cette source native doit être examinée avant une rectification.');
    }
    if (priorId && (!prior || prior.ownerId !== uid || prior.status !== 'rejected' || prior.scope !== scope || prior.kind !== data.kind)) {
      throw new HttpsError('failed-precondition', 'Le dossier précédent doit être une décision refusée vous appartenant dans le même périmètre.');
    }
    const activityAppeal = isSellerActivityReview(prior ?? undefined);
    if (activityAppeal && evidence.profile?.sellerActivityReview?.reviewId !== priorId) {
      throw new HttpsError('failed-precondition', 'Utilisez le dossier d’activité courant avant d’ouvrir un nouveau recours.');
    }
    // A continuation of the same rectification never restarts its legal clock.
    const receipt = data.kind === 'date_of_birth_correction' && prior ? {
      receivedAtMs: prior.receivedAtMs, receivedCivilDate: prior.receivedCivilDate, statutoryDueDate: prior.statutoryDueDate,
    } : { receivedAtMs, receivedCivilDate,
      statutoryDueDate: data.kind === 'date_of_birth_correction' ? civilDateAfterDays(receivedCivilDate, 30) : null };
    if (data.kind === 'date_of_birth_correction' && (!Number.isSafeInteger(receipt.receivedAtMs) || !receipt.receivedCivilDate || !receipt.statutoryDueDate)) {
      throw new HttpsError('failed-precondition', 'La réception du dossier précédent nécessite un rapprochement administratif.');
    }
    const record = { ownerId: uid, kind: data.kind, scope, status: 'submitted', version: 1,
      reason, proposedDateOfBirth: proposed, originalDateOfBirth: existingDob(evidence.user) ? evidence.user.dateOfBirth : null,
      originalDateOfBirthCopy: dateOfBirthCopy(evidence.user.dateOfBirth),
      nativeSourceDocumentVersion: data.kind === 'date_of_birth_correction' ? evidence.nativeSourceDocumentVersion ?? null : null,
      priorReviewId: priorId, policyVersion: ELIGIBILITY_POLICY_VERSION, createdAt: stamp(), updatedAt: stamp(),
      ...receipt, submittedAtMs: receivedAtMs,
      statutoryResponseDays: data.kind === 'date_of_birth_correction' ? 30 : null,
      deadlineCalendarPolicy: data.kind === 'date_of_birth_correction' ? 'quebec_civil_received_plus_30' : null,
      ownerDecisionReason: null, internalNote: null, latestOwnerDetails: null,
      ...(activityAppeal ? {sellerActivityReview: {...prior!.sellerActivityReview,
        originalReviewId: prior!.sellerActivityReview.originalReviewId ?? priorId}} : {}) };
    const currentReviews = activeReviewPatch(evidence.profile, id, data.kind, scope, true);
    // The successor stays blocking in this SAME commit. Superseding only this
    // linked review avoids accumulating stale restrictions over appeal chains;
    // the original decision and its associated signal remain intact.
    if (activityAppeal && priorId) currentReviews[priorId] = {scope, active:false};
    const profile = nextProfile(evidence.profile, { activeReviews: currentReviews,
      ...(activityAppeal ? {sellerActivityReview: {...evidence.profile!.sellerActivityReview, reviewId:id}} : {}) });
    const ownerNotice = activityAppeal ? sellerActivityReviewNotice(uid, id, 'appeal_received') : null;
    const notices = ownerNotice ? await prepareOperationalNotices(tx, [ownerNotice]) : null;
    await assertPrivateAccountSession(request, tx);
    tx.set(ref, record); tx.set(db.collection(C.profiles).doc(uid), profile);
    audit(tx, opRef, 'request_review', hash, uid, uid, { reviewId: id, ...(ownerNotice ? {ownerNotice} : {}) });
    notices?.commit();
    return { recorded: true, alreadyRecorded: false, request: ownerReviewDto(id, record), eligibility: ownerEligibilityDto({ ...evidence, profile }) };
  });

  });
});

export const addEligibilityReviewDetails = onCall(OPTIONS, async request => {
  return withPrivateAccountSession(request, async () => {
  const uid = authUid(request);
  const data = input(request.data, ['reviewId', 'details', 'expectedRequestVersion', 'expectedVersion', 'requestId']);
  const id = identifier(data.reviewId), details = text(data.details, 'Précisions'), requestId = identifier(data.requestId);
  const ref = db.collection(C.requests).doc(id), opRef = operationRef(uid, requestId), hash = payloadHash(data);
  return db.runTransaction(async tx => {
    await assertPrivateAccountSession(request, tx);
    const op = (await tx.get(opRef)).data(), record = (await tx.get(ref)).data();
    if (!record || record.ownerId !== uid) throw new HttpsError('permission-denied', 'Cette demande ne vous appartient pas.');
    const evidence = await readEligibilityEvidence(tx, uid);
    if (replay(op, 'review_details', hash)) return { recorded: true, alreadyRecorded: true, request: ownerReviewDto(id, record), eligibility: ownerEligibilityDto(evidence) };
    expectVersion(data.expectedVersion, evidence); expectRequestVersion(data.expectedRequestVersion, record);
    if (!['submitted', 'needs_information'].includes(record.status)) throw new HttpsError('failed-precondition', 'Cette demande est close. Demandez un nouvel examen.');
    const updated = { ...record, latestOwnerDetails: details, status: 'submitted', version: record.version + 1, updatedAt: stamp() };
    const profile = nextProfile(evidence.profile, {});
    tx.update(ref, { latestOwnerDetails: details, status: 'submitted', version: updated.version, updatedAt: stamp() });
    tx.set(db.collection(C.profiles).doc(uid), profile);
    audit(tx, opRef, 'review_details', hash, uid, uid, { reviewId: id, details });
    return { recorded: true, alreadyRecorded: false, request: ownerReviewDto(id, updated), eligibility: ownerEligibilityDto({ ...evidence, profile }) };
  });

  });
});

export const getEligibilityReview = onCall(OPTIONS, async request => {
  return withPrivateAccountSession(request, async () => {
  const uid = authUid(request), data = input(request.data, ['reviewId']), id = identifier(data.reviewId);
  return db.runTransaction(async tx => {
    await assertPrivateAccountSession(request, tx);
    const record = (await tx.get(db.collection(C.requests).doc(id))).data();
    if (!record || record.ownerId !== uid) throw new HttpsError('permission-denied', 'Cette demande ne vous appartient pas.');
    return { request: ownerReviewDto(id, record), eligibility: ownerEligibilityDto(await readEligibilityEvidence(tx, uid)) };
  });

  });
});

/** Owner private list and admin queue use ID ASC cursors, never a timestamp-only cursor. */
export const listMyEligibilityReviews = onCall(OPTIONS, async request => {
  return withPrivateAccountSession(request, async () => {
  const uid = authUid(request), data = input(request.data, ['cursor']);
  let query = db.collection(C.requests).where('ownerId', '==', uid).orderBy('__name__').limit(50);
  if (data.cursor != null) query = query.startAfter(identifier(data.cursor, 'Curseur'));
  const snap = await query.get();
  return { items: snap.docs.map(d => ownerReviewDto(d.id, d.data())), cursor: snap.docs.at(-1)?.id ?? null, hasMore: snap.size === 50 };

  });
});

export const listAdminEligibilityReviews = onCall(OPTIONS, async request => {
  return withPrivateAccountSession(request, async () => {
  await adminUid(request); const data = input(request.data, ['cursor', 'status']);
  if (data.status != null && !['submitted', 'needs_information', 'approved', 'rejected'].includes(data.status)) throw new HttpsError('invalid-argument', 'État invalide.');
  let query: FirebaseFirestore.Query = db.collection(C.requests).orderBy('__name__').limit(50);
  query = data.status ? query.where('status', '==', data.status) : query.where('status', 'in', ['submitted', 'needs_information']);
  if (data.cursor != null) query = query.startAfter(identifier(data.cursor, 'Curseur'));
  const snap = await query.get();
  return { items: snap.docs.map(d => ({ ...ownerReviewDto(d.id, d.data()), ownerId: d.data().ownerId })),
    cursor: snap.docs.at(-1)?.id ?? null, hasMore: snap.size === 50 };

  });
});

export const getAdminEligibilityReview = onCall(OPTIONS, async request => {
  return withPrivateAccountSession(request, async () => {
  const admin = await adminUid(request), data = input(request.data, ['reviewId', 'relatedSalesCursor','activityHistoryCursor','initiatedSwapsCursor','receivedSwapsCursor']), id = identifier(data.reviewId);
  const salesCursor = data.relatedSalesCursor ?? null;
  if (salesCursor !== null && (typeof salesCursor !== 'string' || salesCursor.length === 0 ||
      Buffer.byteLength(salesCursor, 'utf8') > 1500 || salesCursor.includes('/') ||
      salesCursor === '.' || salesCursor === '..' || /^__[\s\S]*__$/.test(salesCursor))) {
    throw new HttpsError('invalid-argument', 'Curseur des ventes invalide.');
  }
  const cursor = (value: unknown) => value == null ? null : identifier(value,'Curseur');
  const result = await db.runTransaction(async tx => {
    await assertPrivateAccountSession(request, tx);
    await recheckAdmin(tx, request, admin);
    const record = (await tx.get(db.collection(C.requests).doc(id))).data();
    if (!record) throw new HttpsError('not-found', 'Demande introuvable.');
    const ownerId=identifier(record.ownerId,'Propriétaire');
    const evidence = await readEligibilityEvidence(tx, ownerId);
    const relatedSales=await readSellerActivitySales(tx,ownerId,salesCursor);
    const history=await readSellerActivityHistory(tx,ownerId,cursor(data.activityHistoryCursor));
    const relatedSwaps=await readSellerActivitySwaps(tx,ownerId,cursor(data.initiatedSwapsCursor),cursor(data.receivedSwapsCursor));
    return { request: { ...ownerReviewDto(id, record), ownerId: record.ownerId, internalNote: record.internalNote ?? null,
      priorReviewId: record.priorReviewId ?? null, sellerActivityReview:sellerActivityAdminReviewDto(record) },
      eligibility: ownerEligibilityDto(evidence), signals: adminSignalsDto(evidence.profile?.signals), relatedSales,history,relatedSwaps };
  });
  // Auth and native private role are requalified after the complete page IO.
  await db.runTransaction(tx=>recheckAdmin(tx,request,admin));
  return result;

  });
});

export const flagEligibilityForReview = onCall(OPTIONS, async request => {
  if (request.data?.capability === SELLER_ACTIVITY_REVIEW_CAPABILITY) return handleSellerActivityReview(request);
  return withPrivateAccountSession(request, async () => {
  const admin = await adminUid(request), data = input(request.data, ['ownerId', 'scope', 'internalNote', 'expectedVersion', 'requestId']);
  const uid = identifier(data.ownerId), scope = scopeOf(data.scope), note = text(data.internalNote, 'Note interne');
  const requestId = identifier(data.requestId), ref = operationRef(admin, requestId), hash = payloadHash(data);
  const signalId = 'signal_' + key(admin, requestId);
  return db.runTransaction(async tx => {
    await assertPrivateAccountSession(request, tx);
    await recheckAdmin(tx, request, admin);
    const op = (await tx.get(ref)).data(), evidence = await readEligibilityEvidence(tx, uid);
    if (!evidence.user) throw new HttpsError('not-found', 'Compte introuvable.');
    if (replay(op, 'flag_review', hash)) return { recorded: true, alreadyRecorded: true, signalId, eligibility: ownerEligibilityDto(evidence) };
    expectVersion(data.expectedVersion, evidence);
    // Compatibility action only supplements an existing OPEN native case. The
    // source-bound activity capability is the entry point for a first case.
    const candidates = Object.entries(evidence.profile?.activeReviews ?? {})
      .filter(([, value]) => (value as any)?.active === true && (value as any)?.scope === scope).map(([id]) => id);
    if (!candidates.length || candidates.length > 20) throw new HttpsError('failed-precondition',
      'Ouvrez d’abord un dossier depuis une annonce ou une commande native.');
    let reviewId: string|null = null;
    for (const id of candidates.sort()) {
      const candidate = (await tx.get(db.collection(C.requests).doc(id))).data();
      if (candidate?.ownerId === uid && candidate.scope === scope && ['submitted','needs_information'].includes(candidate.status)) {
        reviewId = id; break;
      }
    }
    if (!reviewId) throw new HttpsError('failed-precondition', 'Un dossier ouvert du même périmètre est requis.');
    const profile = nextProfile(evidence.profile, { signals: { ...(evidence.profile?.signals ?? {}), [signalId]: {
      scope, active: true, internalNote: note, actorUid: admin, recordedAt: stamp(), reviewId } } });
    await recheckAdmin(tx, request, admin);
    tx.set(db.collection(C.profiles).doc(uid), profile);
    audit(tx, ref, 'flag_review', hash, admin, uid, { signalId, reviewId, internalNote: note });
    return { recorded: true, alreadyRecorded: false, signalId, eligibility: ownerEligibilityDto({ ...evidence, profile }) };
  });

  });
});

export const decideEligibilityReview = onCall(OPTIONS, async request => {
  return withPrivateAccountSession(request, async () => {
  const admin = await adminUid(request), data = input(request.data, ['reviewId', 'outcome', 'ownerReason', 'internalNote',
    'expectedVersion', 'expectedRequestVersion', 'clearSignalIds', 'requestId', 'legalBasis', 'recourse']);
  const id = identifier(data.reviewId), requestId = identifier(data.requestId), reason = text(data.ownerReason, 'Motif propriétaire');
  const note = data.internalNote == null ? null : text(data.internalNote, 'Note interne');
  if (!['request_information', 'reject', 'approve_correction', 'complete_review'].includes(data.outcome)) throw new HttpsError('invalid-argument', 'Décision invalide.');
  const clear = data.clearSignalIds ?? [];
  if (!Array.isArray(clear) || clear.length > 20 || clear.some(x => typeof x !== 'string')) throw new HttpsError('invalid-argument', 'Signaux invalides.');
  const ref = db.collection(C.requests).doc(id), opRef = operationRef(admin, requestId), hash = payloadHash(data);
  return db.runTransaction(async tx => {
    await assertPrivateAccountSession(request, tx);
    await recheckAdmin(tx, request, admin);
    const op = (await tx.get(opRef)).data(), record = (await tx.get(ref)).data();
    if (!record) throw new HttpsError('not-found', 'Demande introuvable.');
    const evidence = await readEligibilityEvidence(tx, record.ownerId);
    if (replay(op, 'decide_review', hash)) {
      const notice = op.ownerNotice ? await readOperationalNoticeReceipt(tx, op.ownerNotice) : null;
      if (op.ownerNotice && !notice) throw new HttpsError('failed-precondition', 'La preuve de notification manque.');
      return { recorded: true, alreadyRecorded: true, request: ownerReviewDto(id, record), eligibility: ownerEligibilityDto(evidence),
        ...(notice ? {notice} : {}) };
    }
    expectVersion(data.expectedVersion, evidence); expectRequestVersion(data.expectedRequestVersion, record);
    if (!['submitted', 'needs_information'].includes(record.status)) throw new HttpsError('failed-precondition', 'La demande est close.');
    const approved = data.outcome === 'approve_correction' || data.outcome === 'complete_review';
    const isRectification = record.kind === 'date_of_birth_correction';
    const legalBasis = isRectification && data.outcome === 'reject' ? text(data.legalBasis, 'Fondement légal du refus') : null;
    const recourse = isRectification && data.outcome === 'reject' ? text(data.recourse, 'Recours communiqué') : null;
    if ((data.outcome === 'approve_correction' && record.kind !== 'date_of_birth_correction') ||
        (data.outcome === 'complete_review' && record.kind !== 'review')) throw new HttpsError('invalid-argument', 'Décision incompatible avec la demande.');
    let user = evidence.user;
    if (data.outcome === 'approve_correction') {
      if (dateOfBirthHasReference(record.originalDateOfBirth) && (!record.nativeSourceDocumentVersion || !evidence.nativeSourceDocumentVersion ||
          record.nativeSourceDocumentVersion.seconds !== evidence.nativeSourceDocumentVersion.seconds ||
          record.nativeSourceDocumentVersion.nanoseconds !== evidence.nativeSourceDocumentVersion.nanoseconds)) {
        throw new HttpsError('failed-precondition', 'Le document contenant cette source native a changé. Un nouvel examen est requis.');
      }
      if (!existingDob(user) || JSON.stringify(dateOfBirthIdentity(user!.dateOfBirth)) !== JSON.stringify(dateOfBirthIdentity(record.originalDateOfBirth))) throw new HttpsError('failed-precondition', 'La première naissance reste au parcours signup/consentement, ou la donnée a changé.');
      const dob = proofDob(record.proposedDateOfBirth);
      user = { ...user, dateOfBirth: dob, dateOfBirthVersion: (Number.isSafeInteger(user!.dateOfBirthVersion) ? user!.dateOfBirthVersion : 0) + 1 };
    }
    if (!approved && clear.length) throw new HttpsError('invalid-argument', 'Les signaux restent actifs pour cette décision.');
    const signals = { ...(evidence.profile?.signals ?? {}) };
    if (approved && isSellerActivityReview(record) && record.sellerActivityReview.signalIds.some((signalId: string) =>
      signals[signalId]?.active === true && !clear.includes(signalId))) {
      throw new HttpsError('failed-precondition', 'Sélectionnez les signaux liés à ce dossier pour terminer cet examen.');
    }
    for (const signalId of clear) {
      const signal = signals[signalId];
      if (!signal || signal.scope !== record.scope) throw new HttpsError('failed-precondition', 'Le signal doit appartenir au même périmètre de ce compte.');
      signals[signalId] = { ...signal, active: false, clearedBy: admin, clearedAt: stamp(), reviewId: id };
    }
    let activeReviews = activeReviewPatch(evidence.profile, id, record.kind, record.scope, !approved);
    if (approved && record.priorReviewId) activeReviews = activeReviewPatch({ activeReviews }, record.priorReviewId, record.kind, record.scope, false);
    const profile = nextProfile(evidence.profile, { signals, activeReviews });
    const status = data.outcome === 'request_information' ? 'needs_information' : approved ? 'approved' : 'rejected';
    const respondedAtMs = Date.now(), respondedCivilDate = quebecCivilDate(new Date(respondedAtMs));
    const updated = { ...record, status, version: record.version + 1, ownerDecisionReason: reason, internalNote: note,
      correctedDateOfBirth: data.outcome === 'approve_correction' ? user!.dateOfBirth : null,
      ownerResponse: isRectification ? { text: reason, legalBasis, recourse, respondedAt: stamp(), respondedAtMs, respondedCivilDate,
        recordedAfterDueDate: !!(record.statutoryDueDate && respondedCivilDate && respondedCivilDate > record.statutoryDueDate) } : null,
      decidedBy: admin, decidedAt: stamp(), updatedAt: stamp() };
    const ownerNotice = isSellerActivityReview(record) ? sellerActivityReviewNotice(record.ownerId, id,
      `decision_${record.version + 1}_${data.outcome}`) : null;
    const notices = ownerNotice ? await prepareOperationalNotices(tx, [ownerNotice]) : null;
    await recheckAdmin(tx, request, admin);
    if (data.outcome === 'approve_correction') tx.update(db.collection('users').doc(record.ownerId), {
      dateOfBirth: user!.dateOfBirth, dateOfBirthVersion: user!.dateOfBirthVersion, updatedAt: stamp() });
    tx.set(db.collection(C.profiles).doc(record.ownerId), profile);
    tx.update(ref, { status, version: updated.version, ownerDecisionReason: reason, internalNote: note,
      correctedDateOfBirth: updated.correctedDateOfBirth, ownerResponse: updated.ownerResponse, decidedBy: admin,
      decidedAt: stamp(), updatedAt: stamp() });
    audit(tx, opRef, 'decide_review', hash, admin, record.ownerId, { reviewId: id, outcome: data.outcome, ownerReason: reason,
      internalNote: note, oldDateOfBirth: evidence.user?.dateOfBirth ?? null, newDateOfBirth: user?.dateOfBirth ?? null,
      clearSignalIds: clear, ...(ownerNotice ? {ownerNotice} : {}) });
    notices?.commit();
    return { recorded: true, alreadyRecorded: false, request: ownerReviewDto(id, updated), eligibility: ownerEligibilityDto({ ...evidence, user, profile }) };
  });

  });
});
