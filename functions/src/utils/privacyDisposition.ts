/** Human, exact-target disposal. No request response releases a global hold. */
import {createHash} from 'node:crypto';
import {Timestamp} from 'firebase-admin/firestore';
import {HttpsError} from 'firebase-functions/v2/https';
import {db, auth, storage} from '../config/firebase';
import {getStripe} from '../config/stripe';
import {supportObject, supportId, supportText, supportHash, supportSourceHash, supportRevision} from './supportRequest';
import {assertOwnedCanadianConnect} from './stripeBank';
import {reserveConnectIdentityClaim, assertConnectIdentityPost, readConnectIdentityClaim} from './connectRecoveryIdentity';
import {assertFinancialRecoveryEffect, assertFinancialRecoverySource} from './financialRecoveryInterlock';
import {privacyRetentionDecision, privacyRetentionView} from './privacyRetention';
import {readPrivacyPreservationCatalogue, privacyDispositionFenceRef} from './privacyPreservationCatalogue';
import {readQualifiedDispositionScope, readDispositionCausalSources} from './privacyDispositionScope';
import {privacyCaseRef, privacyReference, privacyJson, readPrivacyOperationCase, type PrivacyContext, type PrivacyEnvelope} from './privacyOperationsCore';

type Data = FirebaseFirestore.DocumentData;
type Target = {service: 'firestore'; kind: string; id: string|null}|{service: 'storage'; objectName: string; generation: string}|{service: 'auth'}|{service: 'stripe'};
const nativeTime = (value: any): value is Timestamp => value instanceof Timestamp && value.toMillis() > 0 && value.toMillis() <= Date.now();
const DISPOSITION_POLICY = {protocol: 'privacy_disposition_criteria_v1', version: 1,
  sources: ['https://www.cai.gouv.qc.ca/protection-renseignements-personnels/information-entreprises-privees/conservation-destruction-renseignements-personnels'],
  criteria: ['purposes_accomplished', 'legal_retention_examined', 'recourse_preservation_examined', 'every_native_hold_examined_for_exact_target'],
  statutoryRetentionPeriodInvented: false, technicalAdminIsNotAutomaticallyRpr: true} as const;
const stepRef = (caseId: string, id: string) => privacyCaseRef(caseId).collection('privacy_dispositions').doc(id);
export function privacyDispositionTarget(raw: unknown, ownerId: string): Target {
  const s = raw as any;
  if (s?.service === 'firestore') {
    const t = supportObject(raw, ['service', 'kind', 'id']);
    if (!['notification', 'draft', 'saved_search', 'search_history', 'profile'].includes(t.kind) ||
        t.kind === 'profile' && t.id !== null) throw new HttpsError('invalid-argument', 'Objet Firestore personnel admissible requis.');
    return {service: 'firestore', kind: t.kind, id: t.kind === 'profile' ? null : supportId(t.id)};
  }
  if (s?.service === 'storage') {
    const t = supportObject(raw, ['service', 'objectName', 'generation']);
    if (typeof t.objectName !== 'string' || ![`users/${ownerId}/`, `products/${ownerId}/`, `drafts/${ownerId}/`].some(p => t.objectName.startsWith(p)) ||
        t.objectName.length > 1500 || t.objectName.split('/').some((v: string) => ['.', '..'].includes(v)) ||
        typeof t.generation !== 'string' || !/^[1-9]\d*$/.test(t.generation)) throw new HttpsError('invalid-argument', 'Objet privé exact et génération native requis.');
    return {service: 'storage', objectName: t.objectName, generation: t.generation};
  }
  const t = supportObject(raw, ['service']);
  if (!['auth', 'stripe'].includes(t.service)) throw new HttpsError('invalid-argument', 'Étape interservice distincte requise.');
  return {service: t.service};
}
function firestoreTarget(owner: string, target: Extract<Target, {service: 'firestore'}>) {
  if (target.kind === 'profile') return db.collection('users').doc(owner);
  if (target.kind === 'saved_search' || target.kind === 'search_history') return db.collection('users').doc(owner)
    .collection(target.kind === 'saved_search' ? 'savedSearches' : 'searchHistory').doc(target.id!);
  return db.collection(target.kind === 'notification' ? 'notifications' : 'drafts').doc(target.id!);
}
function stripeMissing(error: any) {return error?.code === 'resource_missing' && error?.statusCode === 404 &&
  ['StripeInvalidRequestError', 'invalid_request_error'].includes(error?.type);}
/** All native absence classifications name the exact configured account/object.
 * A permission or transport error is never an absence. */
export async function readPrivacyExternalTarget(ownerId: string, target: Target, accountId: string|null) {
  if (target.service === 'firestore') return null;
  if (target.service === 'auth') {
    try {
      const value = await auth.getUser(ownerId), createdAtMs = Date.parse(value.metadata.creationTime);
      if (value.uid !== ownerId || !Number.isSafeInteger(createdAtMs) || createdAtMs < 1) throw new Error('Native Auth identity unavailable.');
      return {service: 'auth', state: 'present', uid: ownerId, createdAtMs, disabled: value.disabled,
        identityHash: supportSourceHash({uid: value.uid, createdAtMs})};
    } catch (error) {if ((error as {code?: string})?.code === 'auth/user-not-found') return {service: 'auth', state: 'absent', uid: ownerId}; throw error;}
  }
  if (target.service === 'stripe') {
    if (accountId === null) return {service: 'stripe', state: 'not_linked', accountId: null};
    const stripe = getStripe(); if (!stripe) throw new Error('Native Stripe reader unavailable.');
    try {
      const value = await stripe.accounts.retrieve(accountId);
      assertOwnedCanadianConnect(value, ownerId, accountId);
      return {service: 'stripe', state: 'present', accountId, ownerId, type: value.type, country: value.country,
        sourceHash: supportSourceHash({id: value.id, type: value.type, country: value.country, metadata: value.metadata,
          payouts_enabled: value.payouts_enabled, requirements: value.requirements})};
    } catch (error) {if (stripeMissing(error)) return {service: 'stripe', state: 'absent', accountId}; throw error;}
  }
  const file = storage.bucket().file(target.objectName, {generation: target.generation});
  try {
    const [meta] = await file.getMetadata(), bytes = Number(meta.size);
    if (String(meta.generation) !== target.generation || !Number.isSafeInteger(bytes) || bytes < 1 || bytes > 10 * 1024 * 1024 ||
        !/^image\//.test(meta.contentType ?? '') || typeof meta.crc32c !== 'string' || !meta.crc32c) throw new Error('Native image source unavailable.');
    const [buffer] = await file.download({validation: 'crc32c'});
    if (buffer.length !== bytes) throw new Error('Native image generation changed.');
    const expiry = meta.retentionExpirationTime, expiryMs = typeof expiry === 'string' ? Date.parse(expiry) : NaN;
    const retentionState = expiry == null ? 'not_recorded' : !Number.isFinite(expiryMs) ? 'unknown'
      : expiryMs > Date.now() ? 'active' : 'expired';
    return {service: 'storage', state: 'present', objectName: target.objectName, generation: target.generation,
      sizeBytes: bytes, crc32c: meta.crc32c, sha256: createHash('sha256').update(buffer).digest('hex'),
      retentionState, retentionExpiresAt: Number.isFinite(expiryMs) ? new Date(expiryMs).toISOString() : null,
      held: meta.temporaryHold === true || meta.eventBasedHold === true || retentionState === 'active' || retentionState === 'unknown'};
  } catch (error) {if ((error as {code?: number})?.code === 404) return {service: 'storage', state: 'exact_generation_absent',
    objectName: target.objectName, generation: target.generation}; throw error;}
}
async function currentDispositionSource(tx: FirebaseFirestore.Transaction, context: PrivacyContext, target: Target, external: any, authorizedStepId?: string, inspectionReference?: unknown) {
  const profileRef = db.collection('eligibility_profiles').doc(context.ownerId), profile = (await tx.get(profileRef)).data() ?? {};
  const user = (await tx.get(db.collection('users').doc(context.ownerId))).data();
  const accountId = typeof user?.stripeAccountId === 'string' ? user.stripeAccountId :
    typeof profile.accountClosure?.cleanup?.stripeAccountId === 'string' ? profile.accountClosure.cleanup.stripeAccountId : null;
  if (accountId !== null && !/^acct_[A-Za-z0-9_]{1,190}$/.test(accountId)) throw new HttpsError('failed-precondition', 'Compte lié non qualifié.');
  const guard = await tx.get(db.collection('privacy_retention_guards').doc(context.ownerId));
  const catalogue = await readPrivacyPreservationCatalogue(tx);
  const financialCausal = await readDispositionCausalSources(tx, context.ownerId);
  const inspection = inspectionReference != null ? await readQualifiedDispositionScope(tx, context, inspectionReference, target) : null;
  const fence = (await tx.get(privacyDispositionFenceRef(context.ownerId))).data();
  const emptyPage = {docs: [] as FirebaseFirestore.QueryDocumentSnapshot[], size: 0};
  const requests = inspection ? emptyPage : await tx.get(db.collection('support_requests').where('ownerId', '==', context.ownerId).limit(101));
  const authorityCases = inspection ? emptyPage : await tx.get(db.collection('support_requests').where('kind', '==', 'authority_request_private').limit(21));
  const holds = [...requests.docs.slice(0, 100).filter(row => ['personal_data_access', 'personal_data_correction'].includes(row.data().kind)), ...authorityCases.docs.slice(0, 20)]
    .map(row => ({id: row.id, version: Number.isSafeInteger(row.data().version) ? row.data().version : null,
      revision: supportRevision(row), sourceHash: supportSourceHash(row.data()), kind: row.data().kind,
      qualification: row.data().schemaVersion === 1 && (!['personal_data_access', 'personal_data_correction'].includes(row.data().kind) ||
        privacyRetentionView(row.data()).qualification === 'native_preservation') ? 'native_case' : 'unknown'})).sort((a, b) => a.id.localeCompare(b.id));
  const preservation = inspection ? {qualification: 'paged_native_preservation_examined'} : await privacyRetentionDecision(tx, context.ownerId);
  const fullAccount = target.service === 'auth' || target.service === 'stripe' || target.service === 'firestore' && target.kind === 'profile';
  const obligations = inspection ? {blockers: inspection.blockers, financialAbsenceHash: inspection.financialAbsenceHash,
    financialScopeQualified: true, txAsBuyer: emptyPage, txAsSeller: emptyPage} : fullAccount || target.service === 'storage'
    ? await (await import('../callable/users')).deletionObligations(tx, context.ownerId, profile, {maxDocumentsPerSource: 100})
    : {blockers: [] as string[], financialAbsenceHash: null, financialScopeQualified: true,
      txAsBuyer: {docs: [] as FirebaseFirestore.QueryDocumentSnapshot[]}, txAsSeller: {docs: [] as FirebaseFirestore.QueryDocumentSnapshot[]}};
  if (target.service === 'storage' && !inspection) {
    const swaps = [await tx.get(db.collection('swaps').where('initiatorId', '==', context.ownerId).limit(101)),
      await tx.get(db.collection('swaps').where('receiverId', '==', context.ownerId).limit(101))];
    const contracts = new Map([...obligations.txAsBuyer.docs, ...obligations.txAsSeller.docs,
      ...swaps.flatMap(page => page.docs)].map(row => [row.ref.path, row]));
    for (const row of contracts.values()) holds.push({id: 'contract_' + supportHash(row.ref.path), version: null,
      revision: supportRevision(row), sourceHash: supportSourceHash(row.data()), kind: 'retained_contract_media_purpose',
      qualification: 'native_case'});
    holds.sort((a, b) => a.id.localeCompare(b.id));
  }
  let source: any = external, targetRef: FirebaseFirestore.DocumentReference|null = null;
  if (target.service === 'firestore') {
    targetRef = firestoreTarget(context.ownerId, target); const native = await tx.get(targetRef), value = native.data();
    if (value && ['notification', 'draft'].includes(target.kind) && value.userId !== context.ownerId) throw new HttpsError('permission-denied', 'Objet personnel d’un autre compte.');
    source = {service: 'firestore', path: targetRef.path, state: native.exists ? 'present' : 'absent',
      revision: supportRevision(native), sourceHash: supportSourceHash(value ?? null)};
  }
  const closure = profile.accountClosure;
  const progress = closure?.privacyDispositionProgress;
  let progressQualified = false, progressPending = false;
  if (progress && typeof progress.caseId === 'string' && !progress.caseId.includes('/') &&
      typeof progress.reference?.id === 'string' && !progress.reference.id.includes('/')) {
    const previous = (await tx.get(stepRef(progress.caseId, progress.reference.id))).data();
    progressQualified = previous?.protocol === 'privacy_disposition_v1' && previous.ownerId === context.ownerId &&
      supportHash(previous.reference) === supportHash(progress.reference) && nativeTime(progress.postAuthorizedAt) &&
      nativeTime(previous.postAuthorizedAt) && progress.postAuthorizedAt.isEqual(previous.postAuthorizedAt);
    progressPending = progressQualified && ['post_authorized', 'unknown'].includes(previous!.state);
  }
  const ownProgress = progressQualified && progress.reference.id === authorizedStepId;
  const barrier = closure?.schemaVersion === 1 && closure.ownerId === context.ownerId && nativeTime(closure.requestedAt) &&
    ['paused', 'purging'].includes(closure.phase) && (!closure.leaseUntilMs || closure.leaseUntilMs <= Date.now() || ownProgress);
  const blockers = [...(fullAccount || target.service === 'storage' ? obligations.blockers.filter(b => b !== 'privacy_retention_review_required') : []),
    ...(fullAccount || target.service === 'storage' ? financialCausal.blockers : []),
    ...(financialCausal.deployment.qualifiedAt && context.snapshot.readTime.toMillis() < Date.parse(financialCausal.deployment.qualifiedAt)
      ? ['native_capture_precedes_writer_drain'] : []),
    ...(profile.accountClosure?.requiresOperator === true && (fullAccount || target.service === 'storage') ? ['financial_reconciliation_required'] : []),
    ...(!barrier && target.service !== 'firestore' || !barrier && fullAccount ? ['native_account_closure_barrier_required'] : []),
    ...(requests.size > 100 || authorityCases.size > 20 ? ['native_hold_scope_requires_pagination'] : []),
    ...(holds.some(hold => hold.qualification === 'unknown') ? ['unqualified_native_preservation_case'] : []),
    ...(preservation.qualification === 'unknown' ? ['native_privacy_preservation_scope_unknown'] : []),
    ...(!catalogue.qualified ? ['native_preservation_catalogue_unknown'] : []),
    ...(target.service === 'storage' && external?.held !== false && external?.state === 'present' ? ['native_storage_hold_retained'] : [])];
  if (fullAccount || target.service === 'storage') {
    if (progress && !progressQualified) blockers.push('native_disposition_progress_unqualified');
    if (progressPending && !ownProgress) blockers.push('previous_disposition_requires_native_reconciliation');
    if (closure?.phase === 'purging' && !progress) blockers.push('legacy_cleanup_requires_native_reconciliation');
    if (fence && (!['intent_recorded', 'send_authorized', 'reconciled'].includes(fence.state) ||
        fence.protocol !== 'privacy_disposition_fence_v1' || fence.ownerId !== context.ownerId || !nativeTime(fence.postAuthorizedAt))) {
      blockers.push('native_disposition_fence_unknown');
    } else if (fence && fence.state !== 'reconciled' && fence.reference?.id !== authorizedStepId && fence.leaseUntilMs > Date.now()) {
      blockers.push('another_native_disposition_fence_active');
    }
  }
  if (target.service === 'stripe' && closure?.providerDeletionStartedAt && !nativeTime(closure.providerAccountDeletedAt) && external?.state === 'present' &&
      (!authorizedStepId || closure.privacyDispositionProvider?.dispositionId !== authorizedStepId ||
        !nativeTime(closure.privacyDispositionProvider?.postAuthorizedAt) || !closure.privacyDispositionProvider.postAuthorizedAt.isEqual(closure.providerDeletionStartedAt))) {
    blockers.push('previous_provider_deletion_requires_native_reconciliation');
  }
  if (target.service === 'auth' && nativeTime(closure?.authDeletedAt) && external?.state === 'present' ||
      target.service === 'stripe' && nativeTime(closure?.providerAccountDeletedAt) && external?.state === 'present') {
    blockers.push('native_deleted_identity_present_again_requires_reconciliation');
  }
  const g = guard.data();
  if (g && (g.protocol !== 'privacy_retention_guard_v1' || g.ownerId !== context.ownerId || !Number.isSafeInteger(g.version) ||
      g.version < 1 || !nativeTime(g.recordedAt) || g.priorUnqualifiedGuardHash != null)) blockers.push('native_privacy_guard_requires_reconciliation');
  const selected = {ownerId: context.ownerId, target, source, accountId, holds, catalogue, financialCausal,
    inspectionReference: inspection?.reference ?? null, holdReviewRoot: inspection?.holdReviewRoot ?? null,
    holdsCoverage: inspection?.holdsCoverage ?? {ownerInspected: Math.min(requests.size, 100), ownerComplete: requests.size <= 100,
      authorityInspected: Math.min(authorityCases.size, 20), authorityComplete: authorityCases.size <= 20, globalLegalUniverseVerified: false},
    financialScopeQualified: obligations.financialScopeQualified,
    preservationQualification: preservation.qualification,
    guard: {exists: guard.exists, revision: supportRevision(guard), sourceHash: supportSourceHash(g ?? null)},
    financialAbsenceHash: obligations.financialAbsenceHash,
    closure: closure ? {schemaVersion: closure.schemaVersion ?? null, ownerId: closure.ownerId ?? null, barrierEstablished: barrier,
      requestedAt: closure.requestedAt ?? null, requiresOperator: closure.requiresOperator ?? false,
      authDeletedAt: closure.authDeletedAt ?? null, providerAccountDeletedAt: closure.providerAccountDeletedAt ?? null} : null,
    blockers: [...new Set(blockers)].sort()};
  return {source: selected, sourceHash: supportSourceHash(selected), profileRef, profile, user, accountId, targetRef};
}
export async function observePrivacyDisposition(request: any, caseId: string, rawTarget: unknown, inspectionReference?: unknown) {
  const initial = await db.runTransaction(async tx => {
    const context = await readPrivacyOperationCase(tx, request, caseId), target = privacyDispositionTarget(rawTarget, context.ownerId);
    const profile = (await tx.get(db.collection('eligibility_profiles').doc(context.ownerId))).data(), user = (await tx.get(db.collection('users').doc(context.ownerId))).data();
    const accountId = user?.stripeAccountId ?? profile?.accountClosure?.cleanup?.stripeAccountId ?? null;
    return {context, target, accountId};
  });
  const external = await readPrivacyExternalTarget(initial.context.ownerId, initial.target, initial.accountId);
  return db.runTransaction(async tx => {
    const context = await readPrivacyOperationCase(tx, request, caseId);
    if (context.ownerId !== initial.context.ownerId) throw new HttpsError('aborted', 'Sujet du dossier modifié.');
    const native = await currentDispositionSource(tx, context, initial.target, external, undefined, inspectionReference);
    if (native.accountId !== initial.accountId) throw new HttpsError('aborted', 'Liaison prestataire modifiée.');
    return {context, target: initial.target, external, ...native};
  });
}
export function privacyDispositionPreview(observed: Awaited<ReturnType<typeof observePrivacyDisposition>>) {
  return {protocol: 'privacy_disposition_preview_v1', caseId: observed.context.caseId, ownerId: observed.context.ownerId,
    target: observed.target, sourceHash: observed.sourceHash, source: privacyJson(observed.source),
    policy: {...DISPOSITION_POLICY, contentHash: supportSourceHash(DISPOSITION_POLICY)},
    legalAuthorityAutomaticallyVerified: false, globalErasureVerified: false, currentNativeSourcesOnly: true};
}
function humanDispositionReview(raw: unknown, holds: Data[]) {
  const review = supportObject(raw, ['policyVersion', 'policyHash', 'purposesAccomplished', 'legalRetentionReviewed', 'legalRetentionRequired', 'recourseReviewed',
    'recoursePreservationRequired', 'scopeReviewed', 'holdReviews', 'basis', 'reason', 'recourse', 'reviewDueAt']);
  if (review.policyVersion !== DISPOSITION_POLICY.version || review.policyHash !== supportSourceHash(DISPOSITION_POLICY) ||
      review.purposesAccomplished !== true || review.legalRetentionReviewed !== true || review.legalRetentionRequired !== false ||
      review.recourseReviewed !== true || review.recoursePreservationRequired !== false || review.scopeReviewed !== true ||
      !Array.isArray(review.holdReviews) || review.holdReviews.length !== holds.length || new Set(review.holdReviews.map((h: any) => h?.id)).size !== holds.length) {
    throw new HttpsError('failed-precondition', 'Fins, conservation légale, recours et chaque maintien natif doivent être examinés pour cet objet exact.');
  }
  const holdReviews = holds.map(hold => {
    const item = supportObject(review.holdReviews.find((r: any) => r?.id === hold.id), ['id', 'version', 'revision', 'sourceHash', 'resolution', 'reason']);
    if (item.version !== hold.version || item.revision !== hold.revision || item.sourceHash !== hold.sourceHash ||
        !['ended_for_exact_target', 'not_applicable_to_exact_target'].includes(item.resolution)) {
      throw new HttpsError('aborted', 'Maintien natif modifié, inconnu ou encore applicable.');
    }
    return {id: hold.id, version: hold.version, revision: hold.revision, sourceHash: hold.sourceHash,
      resolution: item.resolution, reason: supportText(item.reason, 'Motivation relative au maintien')};
  });
  const due = Date.parse(review.reviewDueAt);
  if (typeof review.reviewDueAt !== 'string' || !Number.isFinite(due) || new Date(due).toISOString() !== review.reviewDueAt ||
      due <= Date.now() || due > Date.now() + 90 * 86400_000) throw new HttpsError('invalid-argument', 'Date de réexamen futur dans les 90 jours requise.');
  return {...review, holdReviews, basis: supportText(review.basis, 'Fondement et textes réellement examinés'),
    reason: supportText(review.reason, 'Motivation de la disposition ciblée'), recourse: supportText(review.recourse, 'Recours et instruction opérateur')};
}
export async function preparePrivacyDisposition(tx: FirebaseFirestore.Transaction, context: PrivacyContext, env: PrivacyEnvelope,
  observed: Awaited<ReturnType<typeof observePrivacyDisposition>>) {
  const command = supportObject(env.command, ['action', 'target', 'expectedSourceHash', 'review', 'inspectionReference']);
  const target = privacyDispositionTarget(command.target, context.ownerId), native = await currentDispositionSource(tx, context, target, observed.external, undefined, command.inspectionReference);
  if (supportHash(target) !== supportHash(observed.target) || command.expectedSourceHash !== native.sourceHash || native.sourceHash !== observed.sourceHash) {
    throw new HttpsError('aborted', 'Relisez les objets et tous les maintiens courants.');
  }
  if (native.source.blockers.length) throw new HttpsError('failed-precondition', 'La disposition ciblée reste bloquée.', {blockers: native.source.blockers});
  const review = humanDispositionReview(command.review, native.source.holds);
  const id = 'privacy_disposition_' + supportHash([env.uid, env.requestId]), reference = {id, contentHash: supportSourceHash({ownerId: context.ownerId,
    target, sourceHash: native.sourceHash, review, actorId: env.uid})};
  const value = {protocol: 'privacy_disposition_v1', reference, ownerId: context.ownerId, caseId: context.caseId, target, review,
    sourceHash: native.sourceHash, source: native.source, state: 'authorized', version: 1,
    recordedBy: env.uid, recordedAt: Timestamp.now(), postAuthorizedAt: null, completedAt: null, outcome: null,
    globalErasureVerified: false, financialRecordsDeleted: false, legalAuthorityAutomaticallyVerified: false, rprDesignationAutomaticallyVerified: false};
  return {reference, commit: () => tx.create(stepRef(context.caseId, id), value)};
}
export function privacyDispositionView(step: Data) {
  return {protocol: step.protocol, reference: step.reference, caseId: step.caseId, ownerId: step.ownerId, target: step.target,
    state: step.state, version: step.version, reason: step.review?.reason ?? null, recourse: step.review?.recourse ?? null,
    reviewDueAt: step.review?.reviewDueAt ?? null, recordedAt: nativeTime(step.recordedAt) ? step.recordedAt.toDate().toISOString() : null,
    postAuthorizedAt: nativeTime(step.postAuthorizedAt) ? step.postAuthorizedAt.toDate().toISOString() : null,
    completedAt: nativeTime(step.completedAt) ? step.completedAt.toDate().toISOString() : null, outcome: privacyJson(step.outcome),
    globalErasureVerified: false, financialRecordsDeleted: false, retainedRecords: ['contracts', 'ledger', 'support_and_disposition_receipts']};
}
export async function readPrivacyDisposition(tx: FirebaseFirestore.Transaction, context: PrivacyContext, rawReference: unknown) {
  const reference = privacyReference(rawReference), step = (await tx.get(stepRef(context.caseId, reference.id))).data();
  if (!step || step.protocol !== 'privacy_disposition_v1' || step.ownerId !== context.ownerId || step.caseId !== context.caseId ||
      supportHash(step.reference) !== supportHash(reference) || !['authorized', 'post_authorized', 'complete', 'unknown'].includes(step.state)) {
    throw new HttpsError('failed-precondition', 'Instruction ciblée native requise.');
  }
  if (supportSourceHash(step.source) !== step.sourceHash || reference.contentHash !== supportSourceHash({ownerId: step.ownerId,
      target: step.target, sourceHash: step.sourceHash, review: step.review, actorId: step.recordedBy}) ||
      !Number.isSafeInteger(step.version) || step.version < 1 || !nativeTime(step.recordedAt)) {
    throw new HttpsError('failed-precondition', 'Intégrité de l’instruction native non qualifiée.');
  }
  return step;
}
/** Prepare all reads before caller writes its FIRST receipt and the intent. */
export async function preparePrivacyDispositionExecution(tx: FirebaseFirestore.Transaction, request: any, context: PrivacyContext,
  rawReference: unknown, expectedVersion: unknown, observed: Awaited<ReturnType<typeof observePrivacyDisposition>>) {
  await readPrivacyOperationCase(tx, request, context.caseId);
  const step = await readPrivacyDisposition(tx, context, rawReference);
  if (step.version !== expectedVersion || step.state !== 'authorized') throw new HttpsError('failed-precondition', 'Une étape déjà envoyée doit être rapprochée par GET ; aucun nouvel envoi aveugle.');
  const native = await currentDispositionSource(tx, context, step.target, observed.external, undefined, step.source.inspectionReference);
  if (native.sourceHash !== step.sourceHash || native.sourceHash !== observed.sourceHash || native.source.blockers.length) {
    throw new HttpsError('aborted', 'Sources ou maintiens modifiés ; nouvelle instruction humaine nécessaire.');
  }
  humanDispositionReview(step.review, native.source.holds);
  if (step.target.service === 'firestore' && step.target.kind === 'profile') {
    const authSource = await readPrivacyExternalTarget(context.ownerId, {service: 'auth'}, native.accountId),
      stripeSource = await readPrivacyExternalTarget(context.ownerId, {service: 'stripe'}, native.accountId);
    if (authSource?.state !== 'absent' || !['absent', 'not_linked'].includes(stripeSource?.state ?? '')) {
      throw new HttpsError('failed-precondition', 'Les étapes Auth et Stripe doivent être rapprochées séparément avant le profil.');
    }
  }
  const now = Timestamp.now(), claim = native.profile.accountClosure?.privacyDispositionIdentity;
  const noExternalDelete = step.target.service !== 'firestore' && ['absent', 'exact_generation_absent', 'not_linked'].includes(observed.external?.state ?? '');
  let identityInstruction: any = claim ?? null;
  if (!noExternalDelete && (step.target.service !== 'firestore' || step.target.kind === 'profile')) {
    if (native.source.financialScopeQualified !== true || typeof native.source.financialAbsenceHash !== 'string') {
      throw new HttpsError('failed-precondition', 'Le périmètre financier natif doit être qualifié avant une disposition interservice.');
    }
    if (!identityInstruction) {
      const commandId = step.reference.id, requestHash = supportSourceHash({ownerId: context.ownerId, reference: step.reference, sourceHash: step.sourceHash});
      await reserveConnectIdentityClaim(tx, context.ownerId, 'delete', commandId, requestHash, native.accountId, native.source.financialAbsenceHash);
      identityInstruction = {commandId, requestHash, accountId: native.accountId};
    }
    if (identityInstruction.accountId !== native.accountId) throw new HttpsError('failed-precondition', 'Instruction indépendante de compte modifiée.');
    if (step.target.service === 'auth' && native.accountId !== null) {
      const provider = await readPrivacyExternalTarget(context.ownerId, {service: 'stripe'}, native.accountId);
      if (provider?.state !== 'absent') throw new HttpsError('failed-precondition', 'Le compte Stripe exact doit être traité avant Auth.');
    }
  }
  await assertFinancialRecoveryEffect('firestore_commit', {refs: [stepRef(context.caseId, step.reference.id).path,
    ...(native.targetRef ? [native.targetRef.path] : [])], sourceHash: native.sourceHash});
  if (identityInstruction && !noExternalDelete) {
    const independent = await readConnectIdentityClaim(context.ownerId, 'delete');
    if (!independent || independent.claim.commandId !== identityInstruction.commandId || independent.claim.requestHash !== identityInstruction.requestHash ||
        independent.claim.accountId !== native.accountId) throw new HttpsError('failed-precondition', 'Instruction indépendante de disposition requise.');
    await assertFinancialRecoverySource({ref: native.profileRef.path, nativeSourceHash: supportSourceHash({protocol: 'connect_delete_absences_v1',
      parentHash: independent.claim.parentHash, financialAbsenceHash: native.source.financialAbsenceHash})});
  }
  return {reference: step.reference, external: step.target.service !== 'firestore' && !noExternalDelete, step, identityInstruction,
    commit() {
      if (step.target.service === 'firestore') {
        if (native.targetRef && native.source.source.state === 'present') tx.delete(native.targetRef);
        if (step.target.kind === 'profile') tx.update(native.profileRef, {'accountClosure.phase': 'complete', 'accountClosure.status': 'complete',
          'accountClosure.completedAt': now, 'accountClosure.leaseUntilMs': 0, 'accountClosure.authDeletedAt': now,
          'accountClosure.lifecycleCompletionScope': 'auth_stripe_profile_exact_targets', 'accountClosure.personalDataErasureVerified': false});
        tx.update(stepRef(context.caseId, step.reference.id), {state: 'complete', version: step.version + 1, completedAt: now,
          outcome: {service: 'firestore', exactDocumentAbsentAfterCommit: true, sourceHash: step.sourceHash, globalErasureVerified: false}});
      } else if (noExternalDelete) {
        tx.update(stepRef(context.caseId, step.reference.id), {state: 'complete', version: step.version + 1, completedAt: now,
          outcome: {service: step.target.service, sendOutcome: 'no_delete_required', nativeGet: observed.external,
            exactTargetAbsenceVerified: observed.external?.state !== 'not_linked', configuredNativeLinkAbsent: observed.external?.state === 'not_linked',
            globalErasureVerified: false, reconciledAt: now}});
        if (step.target.service === 'auth' && observed.external?.state === 'absent') tx.update(native.profileRef, {'accountClosure.authDeletedAt': now});
        if (step.target.service === 'stripe' && observed.external?.state === 'absent') tx.update(native.profileRef,
          {'accountClosure.providerAccountDeleted': true, 'accountClosure.providerAccountDeletedAt': now});
      } else {
        tx.update(stepRef(context.caseId, step.reference.id), {state: 'post_authorized', version: step.version + 1, postAuthorizedAt: now});
        tx.set(privacyDispositionFenceRef(context.ownerId), {protocol: 'privacy_disposition_fence_v1', ownerId: context.ownerId,
          caseId: context.caseId, reference: step.reference, sourceHash: step.sourceHash, targetHash: supportHash(step.target),
          catalogue: native.source.catalogue, state: 'intent_recorded', postAuthorizedAt: now,
          leaseUntilMs: Date.now() + 180_000, sendAuthorizedAt: null});
        tx.update(native.profileRef, {'accountClosure.phase': 'purging', 'accountClosure.status': 'incomplete',
          'accountClosure.leaseUntilMs': Date.now() + 180_000,
          'accountClosure.privacyDispositionProgress': {caseId: context.caseId, reference: step.reference, postAuthorizedAt: now}});
        if (identityInstruction) tx.update(native.profileRef, {'accountClosure.privacyDispositionIdentity': identityInstruction});
        if (step.target.service === 'stripe') tx.update(native.profileRef, {'accountClosure.providerDeletionStartedAt': now,
          'accountClosure.privacyDispositionProvider': {dispositionId: step.reference.id, postAuthorizedAt: now}});
      }
    }};
}
export async function finishPrivacyExternalStep(request: any, caseId: string, rawReference: unknown, execute: boolean, identityInstruction?: any) {
  const initial = await db.runTransaction(async tx => {
    const context = await readPrivacyOperationCase(tx, request, caseId), step = await readPrivacyDisposition(tx, context, rawReference);
    if (!['post_authorized', 'unknown', 'complete'].includes(step.state)) throw new HttpsError('failed-precondition', 'Envoi natif préalable requis.');
    return {context, step};
  });
  if (initial.step.state === 'complete') return;
  const target = initial.step.target as Target;
  if (target.service === 'firestore') throw new HttpsError('invalid-argument', 'Cette étape ne nécessite aucun envoi externe.');
  let sendOutcome = 'not_repeated', errorCode: string|null = null;
  if (execute) {
    try {
      // Authorization was durably committed before this one attempt. Reconcile
      // mode never invokes DELETE, even when GET still shows the old account.
      const currentExternal = await readPrivacyExternalTarget(initial.context.ownerId, target, initial.step.source.accountId);
      await db.runTransaction(async tx => {
        const context = await readPrivacyOperationCase(tx, request, caseId), native = await currentDispositionSource(tx, context, target, currentExternal, initial.step.reference.id, initial.step.source.inspectionReference);
        if (native.sourceHash !== initial.step.sourceHash || native.source.blockers.length) throw new HttpsError('aborted', 'Maintiens ou obligations modifiés avant l’envoi externe.');
        humanDispositionReview(initial.step.review, native.source.holds);
        const independent = await readConnectIdentityClaim(context.ownerId, 'delete');
        if (!independent || independent.claim.commandId !== identityInstruction?.commandId) throw new HttpsError('failed-precondition', 'Instruction indépendante changée.');
        await assertFinancialRecoverySource({ref: native.profileRef.path, nativeSourceHash: supportSourceHash({protocol: 'connect_delete_absences_v1',
          parentHash: independent.claim.parentHash, financialAbsenceHash: native.source.financialAbsenceHash})});
        const fenceRef = privacyDispositionFenceRef(context.ownerId), fence = (await tx.get(fenceRef)).data();
        if (!fence || fence.state !== 'intent_recorded' || fence.sourceHash !== initial.step.sourceHash ||
            supportHash(fence.reference) !== supportHash(initial.step.reference) || fence.caseId !== caseId ||
            !nativeTime(fence.postAuthorizedAt) || !fence.postAuthorizedAt.isEqual(initial.step.postAuthorizedAt) ||
            !Number.isSafeInteger(native.profile.accountClosure?.leaseUntilMs) || native.profile.accountClosure.leaseUntilMs <= Date.now() ||
            fence.leaseUntilMs <= Date.now()) throw new HttpsError('aborted', 'Ancre ou lease native expirée ; seul un rapprochement est permis.');
        tx.update(fenceRef, {state: 'send_authorized', sendAuthorizedAt: Timestamp.now(), sendLeaseUntilMs: Date.now() + 30_000});
      });
      if (target.service !== 'storage') await assertConnectIdentityPost(initial.context.ownerId, 'delete', identityInstruction.commandId,
        identityInstruction.requestHash, identityInstruction.accountId);
      // A native anchor orders the one attempt with current hold writers. The
      // provider cannot join Firestore's transaction: a later concurrent hold is
      // retained as a conflict, never represented as legal disposal completion.
      await db.runTransaction(async tx => {
        const context = await readPrivacyOperationCase(tx, request, caseId), catalogue = await readPrivacyPreservationCatalogue(tx), causal = await readDispositionCausalSources(tx, context.ownerId),
          profile = (await tx.get(db.collection('eligibility_profiles').doc(context.ownerId))).data(),
          fence = (await tx.get(privacyDispositionFenceRef(context.ownerId))).data();
        if (!catalogue.qualified || supportHash(catalogue) !== supportHash(initial.step.source.catalogue) ||
            supportHash(causal) !== supportHash(initial.step.source.financialCausal) ||
            !fence || fence.protocol !== 'privacy_disposition_fence_v1' || fence.state !== 'send_authorized' ||
            fence.ownerId !== context.ownerId || fence.caseId !== caseId || supportHash(fence.reference) !== supportHash(initial.step.reference) ||
            fence.sourceHash !== initial.step.sourceHash || fence.targetHash !== supportHash(target) ||
            !nativeTime(fence.sendAuthorizedAt) || !Number.isSafeInteger(fence.sendLeaseUntilMs) || fence.sendLeaseUntilMs <= Date.now() ||
            !Number.isSafeInteger(profile?.accountClosure?.leaseUntilMs) || profile!.accountClosure.leaseUntilMs <= Date.now() ||
            supportHash(profile?.accountClosure?.privacyDispositionProgress?.reference ?? null) !== supportHash(initial.step.reference)) {
          throw new HttpsError('aborted', 'Catalogue, barrière ou ancre modifiés juste avant l’envoi ; aucune nouvelle tentative aveugle.');
        }
      });
      if (target.service === 'storage') {
        await storage.bucket().file(target.objectName, {generation: target.generation}).delete({ifGenerationMatch: target.generation});
      } else {
        if (target.service === 'auth') await auth.deleteUser(initial.context.ownerId);
        else {const stripe = getStripe(); if (!stripe) throw new Error('Stripe unavailable.'); await stripe.accounts.del(identityInstruction.accountId);}
      }
      sendOutcome = 'api_response_recorded';
    } catch (error) {sendOutcome = 'failed_or_unknown'; errorCode = typeof (error as any)?.code === 'string' ? (error as any).code.slice(0, 100) : 'external_outcome_unknown';}
  }
  let source: any = null;
  try {source = await readPrivacyExternalTarget(initial.context.ownerId, target, initial.step.source.accountId);} catch {/* Unknown is retained. */}
  const absent = source && ['absent', 'exact_generation_absent', 'not_linked'].includes(source.state);
  await db.runTransaction(async tx => {
    const context = await readPrivacyOperationCase(tx, request, caseId), current = await readPrivacyDisposition(tx, context, rawReference);
    if (current.state === 'complete') return;
    if (!nativeTime(current.postAuthorizedAt) || !current.postAuthorizedAt.isEqual(initial.step.postAuthorizedAt)) throw new HttpsError('aborted', 'Instruction native modifiée.');
    const profileRef = db.collection('eligibility_profiles').doc(context.ownerId), profile = (await tx.get(profileRef)).data();
    const catalogue = await readPrivacyPreservationCatalogue(tx), causal = await readDispositionCausalSources(tx, context.ownerId), fenceRef = privacyDispositionFenceRef(context.ownerId),
      fence = (await tx.get(fenceRef)).data();
    const preservationConflict = current.outcome?.preservationConflictDetected === true || !catalogue.qualified ||
      supportHash(catalogue) !== supportHash(initial.step.source.catalogue) || supportHash(causal) !== supportHash(initial.step.source.financialCausal);
    const completed = absent && !preservationConflict;
    const now = Timestamp.now();
    tx.update(stepRef(caseId, current.reference.id), {state: completed ? 'complete' : 'unknown', version: current.version + 1,
      completedAt: completed ? now : null, outcome: {service: target.service, sendOutcome, errorCode,
        nativeGet: source, exactTargetAbsenceVerified: !!absent, currentObjectAbsentVerified: target.service === 'storage' ? false : !!absent,
        preservationConflictDetected: preservationConflict, preservationConflictRequiresHumanReview: preservationConflict,
        interserviceAtomicityVerified: false, globalErasureVerified: false, reconciledAt: now}});
    if (fence?.ownerId === context.ownerId && supportHash(fence.reference) === supportHash(current.reference)) {
      tx.update(fenceRef, {state: 'reconciled', leaseUntilMs: 0, sendLeaseUntilMs: 0, reconciledAt: now,
        exactTargetAbsenceVerified: !!absent, preservationConflictDetected: preservationConflict});
    }
    if (absent && profile?.accountClosure?.ownerId === context.ownerId) {
      if (target.service === 'auth') tx.update(profileRef, {'accountClosure.authDeletedAt': now});
      if (target.service === 'stripe') tx.update(profileRef, {'accountClosure.providerAccountDeleted': true, 'accountClosure.providerAccountDeletedAt': now});
    }
    if (profile?.accountClosure?.privacyDispositionProgress?.reference?.id === current.reference.id) {
      tx.update(profileRef, {'accountClosure.leaseUntilMs': 0});
    }
  });
}
