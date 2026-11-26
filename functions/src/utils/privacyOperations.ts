/** Existing support callables route this isolated privacy-operations protocol. */
import {HttpsError} from 'firebase-functions/v2/https';
import {Timestamp} from 'firebase-admin/firestore';
import {db} from '../config/firebase';
import {supportObject, supportId, supportText, supportHash, supportSourceHash, supportRevision, supportUid} from './supportRequest';
import {assertPrivateAccountSession, withPrivateAccountSession} from './privateAccountSession';
import {withFinancialRecoveryScope} from './financialRecoveryInterlock';
import {checkRateLimit} from './rateLimit';
import {SUPPORT_PRIVACY_OPERATIONS_CAPABILITY, privacyEnvelope, earlyPrivacyReceipt, commitPrivacyReceipt, readPrivacyOperationCase,
  privacyCaseRef, privacyReference, privacyJson, type PrivacyContext, type PrivacyEnvelope} from './privacyOperationsCore';
import {preparePrivacyCapture, observePrivacyCapturePage, preparePrivacyCaptureAdvance, readPrivacyCapture, preparePrivacyCopy, privacyCaptureView} from './privacyCapture';
import {observePrivacyDisposition, privacyDispositionTarget, privacyDispositionPreview, preparePrivacyDisposition, readPrivacyDisposition, privacyDispositionView,
  preparePrivacyDispositionExecution, finishPrivacyExternalStep} from './privacyDisposition';
import {preparePrivacyDispositionScope, observePrivacyDispositionScopeAdvance, preparePrivacyDispositionScopeAdvance,
  readPrivacyDispositionScope, privacyDispositionScopeView} from './privacyDispositionScope';
export {SUPPORT_PRIVACY_OPERATIONS_CAPABILITY} from './privacyOperationsCore';

function correctionPatch(raw: unknown) {
  const value = supportObject(raw, ['displayName', 'bio']);
  if (!Object.keys(value).length) throw new HttpsError('invalid-argument', 'Au moins un champ personnel admissible est requis.');
  return Object.fromEntries(Object.entries(value).map(([key, next]) => {
    if (key === 'displayName' && (typeof next !== 'string' || !next.trim()) || next !== null && (typeof next !== 'string' || next.length > (key === 'bio' ? 2000 : 150))) throw new HttpsError('invalid-argument', 'Champ de rectification invalide.');
    return [key, typeof next === 'string' ? next.trim() : null];
  }));
}
async function correctionPreview(tx: FirebaseFirestore.Transaction, context: PrivacyContext, raw: unknown) {
  if (context.ticket.kind !== 'personal_data_correction') throw new HttpsError('invalid-argument', 'Une demande native de rectification est requise.');
  const patch = correctionPatch(raw), snapshot = await tx.get(db.collection('users').doc(context.ownerId)), data = snapshot.data();
  if (!data) throw new HttpsError('failed-precondition', 'Profil courant absent ; aucun profil ni compte Auth ne sera recréé.');
  const before = Object.fromEntries(Object.keys(patch).map(key => [key, {present: Object.prototype.hasOwnProperty.call(data, key), value: privacyJson(data[key] ?? null)}]));
  const source = {path: snapshot.ref.path, revision: supportRevision(snapshot), sourceHash: supportSourceHash(data), before};
  return {protocol: 'privacy_profile_correction_preview_v1', caseId: context.caseId, ownerId: context.ownerId, source,
    patch, contractsChanged: false, ledgerChanged: false, authEmailPhoneChanged: false};
}
async function prepareCorrection(tx: FirebaseFirestore.Transaction, context: PrivacyContext, env: PrivacyEnvelope) {
  const command = supportObject(env.command, ['action', 'patch', 'expectedSource', 'reason']);
  const preview = await correctionPreview(tx, context, command.patch), expected = supportObject(command.expectedSource, ['path', 'revision', 'sourceHash', 'before']);
  if (supportHash(expected) !== supportHash(preview.source)) throw new HttpsError('aborted', 'Le profil a changé ; relisez les valeurs avant et après.');
  const reason = supportText(command.reason, 'Motivation de la rectification'), id = 'privacy_correction_' + supportHash([env.uid, env.requestId]);
  const entry = {protocol: 'privacy_profile_correction_v1', caseId: context.caseId, ownerId: context.ownerId, actorId: env.uid,
    source: preview.source, patch: preview.patch, reason, recordedAt: Timestamp.now(), contractsChanged: false, ledgerChanged: false, authEmailPhoneChanged: false};
  const reference = {id, contentHash: supportSourceHash(entry)};
  return {reference, commit() {
    tx.update(db.collection('users').doc(context.ownerId), preview.patch);
    tx.create(privacyCaseRef(context.caseId).collection('privacy_corrections').doc(id), {...entry, reference});
  }};
}
async function readOperations(request: any, endpoint: string) {
  if (endpoint !== 'read') throw new HttpsError('invalid-argument', 'Opération de lecture privée requise.');
  const data = supportObject(request.data, ['capability', 'expectedUid', 'mode', 'operation', 'caseId', 'captureReference',
    'dispositionReference', 'copyReference', 'cursor', 'collection', 'patch', 'target', 'inspectionReference']);
  const actorId = supportUid(request), caseId = supportId(data.caseId);
  if (data.operation === 'released_copy' || data.operation === 'released_copies') {
    const reference = data.operation === 'released_copy' ? privacyReference(data.copyReference) : null;
    return db.runTransaction(async tx => {
      await assertPrivateAccountSession(request, tx);
      const ticket = (await tx.get(privacyCaseRef(caseId))).data();
      if (!ticket || !['personal_data_access', 'personal_data_correction'].includes(ticket.kind) || ticket.ownerId !== actorId) {
        throw new HttpsError('permission-denied', 'Copie privée réservée au destinataire natif.');
      }
      if (!reference) {
        let query = privacyCaseRef(caseId).collection('privacy_copies').orderBy('__name__').limit(21);
        if (data.cursor != null) query = query.startAfter(supportId(data.cursor));
        const page = await tx.get(query), rows = page.docs.slice(0, 20), entries = rows.map(row => {
          const copy = row.data(), {reference: nativeReference, ...source} = copy;
          if (copy.protocol !== 'privacy_selected_copy_v1' || copy.ownerId !== actorId || copy.caseId !== caseId ||
              nativeReference?.id !== row.id || supportSourceHash(source) !== nativeReference?.contentHash) {
            throw new HttpsError('failed-precondition', 'Copie native non qualifiée.');
          }
          return {reference: privacyReference(nativeReference), recordedAt: privacyJson(copy.recordedAt), entryCount: copy.entries.length};
        });
        return {protocol: 'privacy_released_copies_v1', actorId, ownerId: actorId, caseId, entries,
          page: {inspected: rows.length, limit: 20, nextCursor: page.size > 20 ? rows.at(-1)!.id : null}, legalRequestCompleted: false};
      }
      const copy = (await tx.get(privacyCaseRef(caseId).collection('privacy_copies').doc(reference.id))).data();
      if (!copy || copy.protocol !== 'privacy_selected_copy_v1' || copy.ownerId !== actorId || copy.caseId !== caseId ||
          supportHash(copy.reference) !== supportHash(reference)) throw new HttpsError('permission-denied', 'Copie privée réservée au destinataire natif.');
      const {reference: _reference, ...source} = copy;
      if (supportSourceHash(source) !== reference.contentHash) throw new HttpsError('failed-precondition', 'Copie native modifiée.');
      const ownerCopy = {protocol: copy.protocol, caseId, ownerId: actorId, captureReference: copy.captureReference,
        entries: copy.entries, recordedAt: privacyJson(copy.recordedAt), minimizationAccepted: true, necessityAccepted: true,
        legalRequestCompleted: false, recipientReadingVerified: false, externalSourcesSearched: false};
      return {protocol: 'privacy_released_copy_view_v1', actorId, caseId, reference, copy: privacyJson(ownerCopy),
        recipientReadingVerified: false, legalRequestCompleted: false};
    });
  }
  if (data.operation === 'disposition_preview') return privacyDispositionPreview(await observePrivacyDisposition(request, caseId, data.target, data.inspectionReference));
  const result = await db.runTransaction(async tx => {
    const context = await readPrivacyOperationCase(tx, request, caseId);
    if (data.operation === 'profile_preview') return correctionPreview(tx, context, data.patch);
    if (data.operation === 'capture_entries') return readPrivacyCapture(tx, context, data.captureReference, data.cursor);
    if (data.operation === 'disposition_detail') return privacyDispositionView(await readPrivacyDisposition(tx, context, data.dispositionReference));
    if (data.operation === 'disposition_scope_detail') return readPrivacyDispositionScope(tx, context, data.inspectionReference);
    if (data.operation !== 'state' || !['captures', 'dispositions', 'copies', 'corrections', 'inspections'].includes(data.collection)) {
      throw new HttpsError('invalid-argument', 'Source privée paginée explicite requise.');
    }
    const collection = {captures: 'privacy_captures', dispositions: 'privacy_dispositions', copies: 'privacy_copies', corrections: 'privacy_corrections', inspections: 'privacy_inspections'}[data.collection as 'captures'|'dispositions'|'copies'|'corrections'|'inspections'];
    let query = privacyCaseRef(caseId).collection(collection).orderBy('__name__').limit(21);
    if (data.cursor != null) query = query.startAfter(supportId(data.cursor));
    const page = await tx.get(query), rows = page.docs.slice(0, 20);
    return {protocol: 'privacy_operations_state_v1', actorId, caseId, ownerId: context.ownerId, collection: data.collection,
      entries: rows.map(row => data.collection === 'inspections' ? privacyDispositionScopeView(row.data()) : data.collection === 'captures' ? privacyCaptureView(row.data()) : data.collection === 'dispositions'
        ? privacyDispositionView(row.data()) : {reference: row.data().reference, recordedAt: privacyJson(row.data().recordedAt),
          reason: data.collection === 'corrections' ? row.data().reason : null}),
      page: {inspected: rows.length, limit: 20, nextCursor: page.size > 20 ? rows.at(-1)!.id : null},
      globalErasureVerified: false, legalRequestCompleted: false};
  });
  await db.runTransaction(tx => readPrivacyOperationCase(tx, request, caseId));
  return result;
}
export async function handleSupportPrivacyOperations(request: any, endpoint: 'owner'|'admin'|'read') {
  return withFinancialRecoveryScope({operation: 'support.privacy_operations_v2'}, () =>
    withPrivateAccountSession(request, () => handlePrivacyOperationsWithSession(request, endpoint)));
}
async function handlePrivacyOperationsWithSession(request: any, endpoint: 'owner'|'admin'|'read') {
  if (request.data?.capability !== SUPPORT_PRIVACY_OPERATIONS_CAPABILITY) throw new HttpsError('invalid-argument', 'Version privée invalide.');
  if (request.data.mode === 'read') return readOperations(request, endpoint);
  const env = privacyEnvelope(request);
  const existing = await db.runTransaction(tx => earlyPrivacyReceipt(tx, request, env));
  if (existing) return existing;
  if (endpoint !== 'admin') throw new HttpsError('permission-denied', 'Instruction privée opérateur requise.');
  await checkRateLimit(env.uid, true, {functionName: 'supportPrivacyOperationsV2', maxCallsAuthenticated: 120, maxCallsUnauthenticated: 0, windowMs: 60_000});
  const command = env.command, caseId = env.descriptor.caseId;
  let capture: Awaited<ReturnType<typeof observePrivacyCapturePage>>|null = null,
    inspection: Awaited<ReturnType<typeof observePrivacyDispositionScopeAdvance>>|null = null,
    disposition: Awaited<ReturnType<typeof observePrivacyDisposition>>|null = null;
  if (command.action === 'capture_advance') {
    supportObject(command, ['action', 'captureReference', 'expectedCaptureVersion']);
    capture = await observePrivacyCapturePage(request, caseId, command.captureReference, command.expectedCaptureVersion);
  }
  if (command.action === 'disposition_scope_advance') {
    supportObject(command, ['action', 'inspectionReference', 'expectedVersion', 'reviews']);
    inspection = await observePrivacyDispositionScopeAdvance(request, caseId, command.inspectionReference, command.expectedVersion, command.reviews);
  }
  if (command.action === 'disposition_authorize') disposition = await observePrivacyDisposition(request, caseId, command.target, command.inspectionReference);
  if (command.action === 'disposition_execute') {
    supportObject(command, ['action', 'dispositionReference', 'expectedVersion']);
    const step = await db.runTransaction(async tx => readPrivacyDisposition(tx, await readPrivacyOperationCase(tx, request, caseId), command.dispositionReference));
    disposition = await observePrivacyDisposition(request, caseId, step.target, step.source.inspectionReference);
  }
  const result = await db.runTransaction(async tx => {
    const early = await earlyPrivacyReceipt(tx, request, env); if (early) return {receipt: early, external: null, reconcile: null};
    const context = await readPrivacyOperationCase(tx, request, caseId);
    let external: Awaited<ReturnType<typeof preparePrivacyDispositionExecution>>|null = null, reconcile: {id: string; contentHash: string}|null = null;
    let plan: {reference: {id: string; contentHash: string}; commit(): void};
    if (command.action === 'capture_prepare') plan = await preparePrivacyCapture(tx, context, env);
    else if (command.action === 'capture_advance') plan = await preparePrivacyCaptureAdvance(tx, context, capture!);
    else if (command.action === 'release_copy') plan = await preparePrivacyCopy(tx, context, env);
    else if (command.action === 'correct_profile') plan = await prepareCorrection(tx, context, env);
    else if (command.action === 'disposition_scope_prepare') plan = await preparePrivacyDispositionScope(tx, context, env, privacyDispositionTarget(command.target, context.ownerId));
    else if (command.action === 'disposition_scope_advance') plan = await preparePrivacyDispositionScopeAdvance(tx, context, inspection!);
    else if (command.action === 'disposition_authorize') plan = await preparePrivacyDisposition(tx, context, env, disposition!);
    else if (command.action === 'disposition_execute') {
      external = await preparePrivacyDispositionExecution(tx, request, context, command.dispositionReference, command.expectedVersion, disposition!);
      plan = external;
    } else if (command.action === 'disposition_reconcile') {
      supportObject(command, ['action', 'dispositionReference']);
      const step = await readPrivacyDisposition(tx, context, command.dispositionReference);
      if (!['post_authorized', 'unknown', 'complete'].includes(step.state)) throw new HttpsError('failed-precondition', 'Envoi préalable à rapprocher requis.');
      reconcile = step.reference; plan = {reference: step.reference, commit() {}};
    } else throw new HttpsError('invalid-argument', 'Instruction privée inconnue.');
    plan.commit();
    return {receipt: commitPrivacyReceipt(tx, env, plan.reference), external, reconcile};
  });
  // FIRST plus transaction retry-local plans prevent a losing callback from sending.
  if (result.external?.external) await finishPrivacyExternalStep(request, caseId, result.external.reference, true, result.external.identityInstruction);
  if (result.reconcile) await finishPrivacyExternalStep(request, caseId, result.reconcile, false);
  return result.receipt;
}
