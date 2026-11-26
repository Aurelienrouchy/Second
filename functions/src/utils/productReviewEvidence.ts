import {productParcelRequested, assertProductParcelNewOpen} from './productReviewParcel';
/** Private submitted image bytes; integrity is neither authenticity nor physical truth. */
import {createHash, randomUUID} from 'node:crypto';
import {Timestamp} from 'firebase-admin/firestore';
import {HttpsError} from 'firebase-functions/v2/https';
import {db, storage} from '../config/firebase';
import {prepareOperationalNotices} from './notifications';
import {assertPrivateAccountSession, withPrivateAccountSession} from './privateAccountSession';
import {supportAdmin, supportHash, supportObject, supportRequestId, supportSourceHash, supportUid} from './supportRequest';
import {PRODUCT_REVIEW_EFFECTS, productReviewCaseId, productReviewCaseRef, productReviewContext, productReviewRoles, readProductReviewSource,
  type ProductReviewContext} from './productReviewSource';
import {readProductReviewContributionProof} from './productReviewContributions';
import {sourceImageWitness} from './privateMedia';

export const PRODUCT_EVIDENCE_TYPES = ['received_item_photo', 'supporting_document_image', 'expertise_image'] as const;
import {productMaterialRequested, assertProductMaterialNewOpen} from './productReviewMaterial';
const MAX_BYTES = 2 * 1024 * 1024, HASH = /^[a-f0-9]{64}$/;
const native = (v: unknown): v is Timestamp => v instanceof Timestamp && v.toMillis() >= 0 && v.toMillis() <= Date.now();
const id = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && Buffer.byteLength(v, 'utf8') <= 1500 && !v.includes('/') && !['.', '..'].includes(v) && !/^__.*__$/.test(v);
type FileInput = {sha256: string; byteLength: number; contentType: 'image/jpeg'; width: number; height: number;
  preparation: 'prepareImageForUpload'; qualityDeclared: 0.75};
type Command = {context: ProductReviewContext; contributionId: string; contributionHash: string; sourceHash: string;
  typeDeclared: typeof PRODUCT_EVIDENCE_TYPES[number]; file: FileInput};
function input(value: unknown): Command {
  const c = supportObject(value, ['context', 'contributionId', 'contributionHash', 'sourceHash', 'typeDeclared', 'file']);
  const f = supportObject(c.file, ['sha256', 'byteLength', 'contentType', 'width', 'height', 'preparation', 'qualityDeclared']);
  if (typeof c.contributionId !== 'string' || !/^pc_[a-f0-9]{64}$/.test(c.contributionId) || !HASH.test(c.contributionHash ?? '') ||
      !HASH.test(c.sourceHash ?? '') || !(PRODUCT_EVIDENCE_TYPES as readonly unknown[]).includes(c.typeDeclared) ||
      !HASH.test(f.sha256 ?? '') || !Number.isSafeInteger(f.byteLength) || f.byteLength <= 0 || f.byteLength > MAX_BYTES ||
      f.contentType !== 'image/jpeg' || !['width', 'height'].every(k => Number.isSafeInteger(f[k]) && f[k] >= 1 && f[k] <= 1200) ||
      f.preparation !== 'prepareImageForUpload' || f.qualityDeclared !== 0.75) throw new HttpsError('invalid-argument', 'Fichier préparé, type déclaré et source exacts requis.');
  return {context: productReviewContext(c.context), contributionId: c.contributionId, contributionHash: c.contributionHash,
    sourceHash: c.sourceHash, typeDeclared: c.typeDeclared, file: {sha256: f.sha256, byteLength: f.byteLength,
      contentType: f.contentType, width: f.width, height: f.height, preparation: f.preparation, qualityDeclared: f.qualityDeclared}};
}
const evidenceId = (uid: string, requestId: string) => 'pf_' + supportHash([uid, requestId]);
const intentRef = (uid: string, requestId: string) => db.collection('product_review_evidence_commands').doc(supportHash([uid, requestId]));
const path = (command: Command, uid: string, requestId: string) => `product_review_evidence/${productReviewCaseId(command.context)}/${supportHash(uid)}/${evidenceId(uid, requestId)}`;
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
/** Bounded JPEG header/segment qualification. A decoder/content/expertise
 * verification is deliberately not claimed by this byte receipt. */
function jpegDimensions(bytes: Buffer) {
  if (bytes.length < 16 || bytes[0] !== 255 || bytes[1] !== 216 || bytes.at(-2) !== 255 || bytes.at(-1) !== 217) throw new HttpsError('invalid-argument', 'JPEG préparé requis.');
  let p = 2, dimensions: {width: number; height: number} | null = null;
  for (let segments = 0; segments < 200 && p + 3 < bytes.length; segments++) {
    if (bytes[p++] !== 255) break;
    while (bytes[p] === 255) p++;
    const marker = bytes[p++];
    if (marker === 218) {if (dimensions) return dimensions; break;}
    if (marker === 217 || marker === 0 || marker === 216) break;
    if (p + 2 > bytes.length) break;
    const length = bytes.readUInt16BE(p);
    if (length < 2 || p + length > bytes.length) break;
    if ([192, 194].includes(marker)) {
      if (length < 11 || bytes[p + 2] !== 8 || ![1, 3].includes(bytes[p + 7]) || length !== 8 + 3 * bytes[p + 7]) break;
      dimensions = {height: bytes.readUInt16BE(p + 3), width: bytes.readUInt16BE(p + 5)};
    }
    p += length;
  }
  throw new HttpsError('invalid-argument', 'En-tête JPEG non qualifié.');
}
function bytesInput(value: unknown, file: FileInput) {
  if (typeof value !== 'string' || value.length > Math.ceil(MAX_BYTES / 3) * 4 || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value))
    throw new HttpsError('invalid-argument', 'Bytes base64 bornés requis, sans URL.');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value || bytes.length !== file.byteLength || sha(bytes) !== file.sha256 ||
      supportHash(jpegDimensions(bytes)) !== supportHash({width: file.width, height: file.height})) throw new HttpsError('invalid-argument', 'Le fichier ne correspond pas à l’intention.');
  return bytes;
}
function qualifiedIntent(value: any, uid: string, requestId: string, command: Command) {
  return value?.protocol === 'product_review_evidence_intent_v1' && value.actorId === uid && value.requestId === requestId &&
    value.evidenceId === evidenceId(uid, requestId) && value.caseId === productReviewCaseId(command.context) &&
    value.payloadHash === supportHash(command) && supportHash(value.command) === value.payloadHash &&
    value.privatePath === path(command, uid, requestId) && native(value.reservedAt) &&
    (value.state === 'not_executed' || ['buyer', 'seller', 'reporter'].includes(value.actorRole)) &&
    (value.state === 'reserved' ? value.uploadAuthorizedAt === null && value.storageProof === null && value.recordedAt === null :
      value.state === 'upload_requested' ? native(value.uploadAuthorizedAt) && typeof value.sendOwner === 'string' &&
        Number.isSafeInteger(value.sendAttempts) && value.sendAttempts >= 1 && value.sendAttempts <= 3 &&
        value.sendLeaseUntil instanceof Timestamp && value.sendLeaseUntil.toMillis() >= value.uploadAuthorizedAt.toMillis() &&
        value.storageProof === null && value.recordedAt === null :
      value.state === 'not_executed' ? value.uploadAuthorizedAt === null && value.storageProof === null && native(value.recordedAt) &&
        ['requester_neutralized', 'source_changed'].includes(value.reason) :
      ['received', 'stored_requires_review'].includes(value.state) && native(value.uploadAuthorizedAt) &&
        storedProof(value.storageProof, command.file) && HASH.test(value.evidenceHash ?? '') && native(value.recordedAt));
}
function storedProof(value: any, file: FileInput) {
  return value?.protocol === 'native_product_evidence_storage_v1' && typeof value.generation === 'string' && /^\d+$/.test(value.generation) &&
    typeof value.crc32c === 'string' && /^[A-Za-z0-9+/]{6}==$/.test(value.crc32c) && value.sha256 === file.sha256 &&
    value.byteLength === file.byteLength && value.contentType === file.contentType && value.width === file.width && value.height === file.height &&
    native(value.observedAt) && value.source === 'native_gcs_metadata_and_bytes';
}
function view(uid: string, requestId: string, command: Command, value?: any) {
  const stored = storedProof(value?.storageProof, command.file);
  return {protocol: 'product_review_evidence_command_v1', actorId: uid, requestId, payloadHash: supportHash(command),
    caseId: productReviewCaseId(command.context), contributionId: command.contributionId, evidenceId: evidenceId(uid, requestId),
    actorRole: value?.actorRole ?? null,
    futureEffectsNeutralized: native(value?.futureEffectsNeutralizedAt), sendAttempts: Number.isSafeInteger(value?.sendAttempts) ? value.sendAttempts : 0,
    state: value?.state === 'upload_requested' ? 'upload_unknown' : value?.state ?? 'unrecorded', reason: value?.reason ?? null,
    evidenceHash: typeof value?.evidenceHash === 'string' && HASH.test(value.evidenceHash) ? value.evidenceHash : null,
    storedNativeVerified: stored, attachedToContributionVerified: stored && value?.state === 'received',
    fileProof: stored ? {generation: value.storageProof.generation, crc32c: value.storageProof.crc32c,
      sha256: value.storageProof.sha256, byteLength: value.storageProof.byteLength, contentType: value.storageProof.contentType,
      width: value.storageProof.width, height: value.storageProof.height} : null,
    recordedAt: native(value?.recordedAt) ? value.recordedAt.toDate().toISOString() : null,
    currentBlobAvailabilityVerified: false, imageDecodeVerified: false, issuerOriginalVerified: false, ...PRODUCT_REVIEW_EFFECTS};
}
async function ownSource(tx: FirebaseFirestore.Transaction, uid: string, command: Command, material = false, parcel = false) {
  const source = await readProductReviewSource(tx, command.context, material, parcel);
  const proof = await readProductReviewContributionProof(tx, command.context, command.contributionId,
    (await tx.get(productReviewCaseRef(command.context).collection('contributions').doc(command.contributionId))).data());
  if (!proof || proof.actorId !== uid) throw new HttpsError('permission-denied', 'Contribution propre native requise.');
  const root = source.caseSnap.data();
  return {source, proof, matches: root?.protocol === 'product_review_case_v1' && root.caseId === source.caseId &&
    supportHash(root.context) === supportHash(command.context) && Number.isSafeInteger(root.version) && root.version >= 1 &&
    root.version < Number.MAX_SAFE_INTEGER - 1 && native(root.createdAt) && productReviewRoles(source, uid).includes(proof.actorRole) &&
    source.sourceHash === command.sourceHash && supportSourceHash(proof) === command.contributionHash};
}
export async function previewProductReviewEvidence(request: any) {
  const uid = supportUid(request), raw = supportObject(request.data, ['operation', 'expectedUid', 'context', 'contributionId', 'materialCapability', 'parcelCapability']);
  const material = productMaterialRequested(raw), parcel = productParcelRequested(raw);
  const context = productReviewContext(raw.context);
  if (typeof raw.contributionId !== 'string' || !/^pc_[a-f0-9]{64}$/.test(raw.contributionId)) throw new HttpsError('invalid-argument', 'Contribution exacte requise.');
  return withPrivateAccountSession(request, () => db.runTransaction(async tx => {
    await assertPrivateAccountSession(request, tx);
    const source = await readProductReviewSource(tx, context, material, parcel), proof = await readProductReviewContributionProof(tx, context, raw.contributionId,
      (await tx.get(productReviewCaseRef(context).collection('contributions').doc(raw.contributionId))).data());
    if (!proof || proof.actorId !== uid || !productReviewRoles(source, uid).includes(proof.actorRole)) throw new HttpsError('permission-denied', 'Contribution propre non qualifiée.');
    const root = source.caseSnap.data();
    if (root?.protocol !== 'product_review_case_v1' || root.caseId !== source.caseId || !Number.isSafeInteger(root.version) ||
        root.version < 1 || root.version >= Number.MAX_SAFE_INTEGER - 1) throw new HttpsError('failed-precondition', 'Dossier natif à rapprocher.');
    return {protocol: 'product_review_evidence_preview_v1', actorId: uid, context, caseId: source.caseId,
      contributionId: raw.contributionId, contributionHash: supportSourceHash(proof), sourceHash: source.sourceHash,
      typesDeclared: [...PRODUCT_EVIDENCE_TYPES], contentType: 'image/jpeg', maxBytes: MAX_BYTES, maxDimension: 1200,
      preparation: 'prepareImageForUpload', qualityDeclared: 0.75, uploadPermissionGranted: false, ...PRODUCT_REVIEW_EFFECTS};
  }));
}
/** Exact native file only; no caller path/URL or download token is accepted. */
async function observeStored(command: Command, uid: string, requestId: string, generation?: string) {
  const file = storage.bucket().file(path(command, uid, requestId), generation ? {generation} : undefined);
  const [metadata] = await file.getMetadata(), witness = sourceImageWitness(metadata), m = metadata.metadata;
  if (generation && witness.sourceGeneration !== generation || metadata.cacheControl !== 'private, no-store' || m?.firebaseStorageDownloadTokens ||
      m?.evidenceId !== evidenceId(uid, requestId) || m?.actorId !== uid || m?.caseId !== productReviewCaseId(command.context) ||
      m?.contributionId !== command.contributionId || m?.payloadHash !== supportHash(command) ||
      witness.size !== command.file.byteLength || witness.contentType !== command.file.contentType) throw new HttpsError('failed-precondition', 'Objet privé non qualifié.');
  const [bytes] = await storage.bucket().file(path(command, uid, requestId), {generation: witness.sourceGeneration}).download();
  if (bytes.length !== command.file.byteLength || sha(bytes) !== command.file.sha256 ||
      supportHash(jpegDimensions(bytes)) !== supportHash({width: command.file.width, height: command.file.height})) throw new HttpsError('failed-precondition', 'Bytes stockés non qualifiés.');
  return {bytes, proof: {protocol: 'native_product_evidence_storage_v1', generation: witness.sourceGeneration, crc32c: witness.sourceCrc32c,
    sha256: sha(bytes), byteLength: bytes.length, contentType: witness.contentType, width: command.file.width, height: command.file.height,
    observedAt: Timestamp.now(), source: 'native_gcs_metadata_and_bytes'}};
}

/** Pure Firestore proof for a documentary corpus; never reads Storage bytes. */
export function readProductReviewEvidenceIntentProof(value: any, context: ProductReviewContext, intentId: string) {
  if (typeof value?.actorId !== 'string' || value.actorId.length < 1 || value.actorId.length > 128 || value.actorId.includes('/')) return null;
  let command: Command, requestId: string;
  try {command = input(value.command); requestId = supportRequestId(value.requestId);} catch {return null;}
  if (supportHash(command.context) !== supportHash(context) || intentId !== supportHash([value.actorId, requestId]) ||
      !qualifiedIntent(value, value.actorId, requestId, command) ||
      value.futureEffectsNeutralizedAt != null && !native(value.futureEffectsNeutralizedAt)) return null;
  return {intent: value, command};
}
export async function readProductReviewEvidenceProof(tx: FirebaseFirestore.Transaction, context: ProductReviewContext, evidence: string, value: any) {
  const d = value?.document;
  if (value?.protocol !== 'product_review_evidence_v1' || !d || d.protocol !== value.protocol || d.evidenceId !== evidence || value.evidenceId !== evidence ||
      typeof d.actorId !== 'string' || typeof d.requestId !== 'string' || evidence !== evidenceId(d.actorId, d.requestId) ||
      value.actorId !== d.actorId || !['buyer', 'seller', 'reporter'].includes(d.actorRole) || d.caseId !== productReviewCaseId(context) || supportHash(d.command?.context) !== supportHash(context) ||
      value.contentHash !== supportSourceHash(d) || !native(d.recordedAt) || typeof d.adopted !== 'boolean') return null;
  let command: Command;
  try {command = input(d.command);} catch {return null;}
  const intent = (await tx.get(intentRef(d.actorId, d.requestId))).data();
  if (!qualifiedIntent(intent, d.actorId, d.requestId, command) || !['received', 'stored_requires_review'].includes(intent!.state) ||
      intent!.actorRole !== d.actorRole || intent!.evidenceHash !== value.contentHash || !storedProof(d.storageProof, command.file) ||
      supportSourceHash(intent!.storageProof) !== supportSourceHash(d.storageProof) || !native(intent!.recordedAt) ||
      !intent!.recordedAt.isEqual(d.recordedAt) || d.adopted !== (intent!.state === 'received') ||
      Object.entries(PRODUCT_REVIEW_EFFECTS).some(([k, v]) => d[k] !== v)) return null;
  return {document: d, intent: intent!, command};
}

export async function commandProductReviewEvidence(request: any) {
  const uid = supportUid(request), raw = supportObject(request.data, ['operation', 'expectedUid', 'requestId', 'action', 'command', 'bytesBase64', 'materialCapability', 'parcelCapability']);
  const material = productMaterialRequested(raw), parcel = productParcelRequested(raw);
  const requestId = supportRequestId(raw.requestId), command = input(raw.command), ref = intentRef(uid, requestId);
  if (!['execute', 'observe', 'neutralize'].includes(raw.action) || raw.action !== 'execute' && raw.bytesBase64 != null)
    throw new HttpsError('invalid-argument', 'Action ou bytes invalides.');
  return withPrivateAccountSession(request, async () => {
  const initial = await db.runTransaction(async tx => {
    await assertPrivateAccountSession(request, tx);
    const existing = (await tx.get(ref)).data();
    if (existing && !qualifiedIntent(existing, uid, requestId, command)) throw new HttpsError('already-exists', 'Cette référence désigne un autre fichier ou une intention inconnue.');
    // Actual native receipt FIRST, independent of current source/profile/role.
    if (existing && ['received', 'stored_requires_review'].includes(existing.state)) {
      const proof = await readProductReviewEvidenceProof(tx, command.context, evidenceId(uid, requestId),
        (await tx.get(productReviewCaseRef(command.context).collection('evidence').doc(evidenceId(uid, requestId)))).data());
      if (!proof) throw new HttpsError('failed-precondition', 'Reçu natif du fichier à rapprocher.');
      return {value: existing, done: true};
    }
    if (existing?.state === 'not_executed' || raw.action === 'observe') return {value: existing, done: true};
    if (raw.action === 'neutralize') {
      if (existing?.uploadAuthorizedAt != null) {
        const value = native(existing.futureEffectsNeutralizedAt) ? existing : {...existing,
          futureEffectsNeutralizedAt: Timestamp.now(), reason: 'future_effects_neutralized'};
        if (value !== existing) tx.update(ref, value);
        return {value, done: true};
      }
      const value = {...(existing ?? {protocol: 'product_review_evidence_intent_v1', actorId: uid, requestId,
        evidenceId: evidenceId(uid, requestId), caseId: productReviewCaseId(command.context), command, payloadHash: supportHash(command),
        actorRole: null, privatePath: path(command, uid, requestId), reservedAt: Timestamp.now()}), state: 'not_executed',
        reason: 'requester_neutralized', uploadAuthorizedAt: null, storageProof: null, recordedAt: Timestamp.now()};
      tx.set(ref, value); return {value, done: true};
    }
    assertProductMaterialNewOpen(material); assertProductParcelNewOpen(parcel);
    if (existing) return {value: existing, done: false};
    const current = await ownSource(tx, uid, command, material, parcel), now = Timestamp.now();
    const captureRef = productReviewCaseRef(command.context).collection('source_captures').doc(command.sourceHash), capture = await tx.get(captureRef);
    if (capture.exists && (capture.data()?.protocol !== 'product_review_source_capture_v1' || capture.data()?.sourceHash !== command.sourceHash ||
        supportSourceHash(capture.data()?.document) !== command.sourceHash || !native(capture.data()?.capturedAt)))
      throw new HttpsError('failed-precondition', 'Capture privée non qualifiée.');
    const value = {protocol: 'product_review_evidence_intent_v1', actorId: uid, requestId, evidenceId: evidenceId(uid, requestId),
      caseId: productReviewCaseId(command.context), command, payloadHash: supportHash(command), privatePath: path(command, uid, requestId),
      actorRole: current.proof.actorRole,
      reservedAt: now, state: current.matches ? 'reserved' : 'not_executed', reason: current.matches ? null : 'source_changed',
      uploadAuthorizedAt: null, storageProof: null, recordedAt: current.matches ? null : now};
    if (current.matches && !capture.exists) tx.create(captureRef, {protocol: 'product_review_source_capture_v1', sourceHash: command.sourceHash,
      document: current.source.document, capturedAt: now});
    tx.create(ref, value); return {value, done: !current.matches};
  });
  if (initial.done) return view(uid, requestId, command, initial.value);
  let stored: Awaited<ReturnType<typeof observeStored>> | undefined;
  let maySend = initial.value?.uploadAuthorizedAt == null;
  if (!maySend) {
    await assertPrivateAccountSession(request);
    try {stored = await observeStored(command, uid, requestId);} catch (error) {
      // This observation is NOT an absence certificate. A bounded re-send of
      // identical bytes remains create-only; a late sender cannot be overwritten.
      maySend = raw.bytesBase64 != null && !!error && typeof error === 'object' && 'code' in error && Number(error.code) === 404;
    }
    await assertPrivateAccountSession(request);
  }
  if (maySend) {
    const bytes = bytesInput(raw.bytesBase64, command.file), sendOwner = randomUUID();
    const authorized = await db.runTransaction(async tx => {
      await assertPrivateAccountSession(request, tx);
      const value = (await tx.get(ref)).data();
      if (!qualifiedIntent(value, uid, requestId, command)) throw new HttpsError('failed-precondition', 'Intention privée modifiée.');
      if (!['reserved', 'upload_requested'].includes(value!.state) || native(value!.futureEffectsNeutralizedAt)) return {send: false, value};
      if ((value!.sendAttempts ?? 0) >= 3) {
        tx.update(ref, {reason: 'upload_retry_limit_reached'}); return {send: false, value: {...value!, reason: 'upload_retry_limit_reached'}};
      }
      if (value!.sendLeaseUntil instanceof Timestamp && value!.sendLeaseUntil.toMillis() > Date.now()) return {send: false, value};
      const current = await ownSource(tx, uid, command, material, parcel);
      if (!current.matches) {
        if (value!.uploadAuthorizedAt != null) {
          tx.update(ref, {reason: 'source_changed'}); return {send: false, value: {...value!, reason: 'source_changed'}};
        }
        const blocked = {...value!, state: 'not_executed', reason: 'source_changed', recordedAt: Timestamp.now()};
        tx.update(ref, blocked); return {send: false, value: blocked};
      }
      const now = Timestamp.now(), next = {...value!, state: 'upload_requested', uploadAuthorizedAt: value!.uploadAuthorizedAt ?? now, sendOwner,
        sendAttempts: (value!.sendAttempts ?? 0) + 1, sendLeaseUntil: Timestamp.fromMillis(now.toMillis() + 60_000)};
      tx.update(ref, next); return {send: true, value: next};
    });
    if (authorized.value?.state === 'not_executed') return view(uid, requestId, command, authorized.value);
    if (authorized.send) {
      await assertPrivateAccountSession(request);
      try {
        await storage.bucket().file(path(command, uid, requestId)).save(bytes, {resumable: false, validation: 'crc32c',
          preconditionOpts: {ifGenerationMatch: 0}, metadata: {contentType: 'image/jpeg', cacheControl: 'private, no-store',
            metadata: {evidenceId: evidenceId(uid, requestId), actorId: uid, caseId: productReviewCaseId(command.context),
              contributionId: command.contributionId, payloadHash: supportHash(command)}}});
      } catch { /* Unknown IO: only the exact object's native GET can prove receipt. */ }
      await assertPrivateAccountSession(request);
    }
  }
  try {await assertPrivateAccountSession(request);
    stored ??= await observeStored(command, uid, requestId);
    await assertPrivateAccountSession(request);
    if (!storedProof(stored.proof, command.file)) throw new HttpsError('failed-precondition', 'Preuve de stockage non qualifiée.');
  } catch {
    return db.runTransaction(async tx => {
      await assertPrivateAccountSession(request, tx);
      const current = (await tx.get(ref)).data();
      if (!qualifiedIntent(current, uid, requestId, command)) throw new HttpsError('failed-precondition', 'Intention du fichier à rapprocher.');
      return view(uid, requestId, command, current);
    });
  }
  const final = await db.runTransaction(async tx => {
    await assertPrivateAccountSession(request, tx);
    const value = (await tx.get(ref)).data();
    if (!qualifiedIntent(value, uid, requestId, command) || !native(value!.uploadAuthorizedAt)) throw new HttpsError('failed-precondition', 'Autorisation native du fichier inconnue.');
    if (['received', 'stored_requires_review'].includes(value!.state)) return value;
    if (value!.state !== 'upload_requested') throw new HttpsError('failed-precondition', 'Intention du fichier à rapprocher.');
    let matches = false;
    try {matches = (await ownSource(tx, uid, command, material, parcel)).matches;} catch (error) {
      if (!(error instanceof HttpsError) || !['permission-denied', 'not-found', 'failed-precondition'].includes(error.code)) throw error;
    }
    const neutralized = native(value!.futureEffectsNeutralizedAt);
    matches = matches && !neutralized;
    const caseRef = productReviewCaseRef(command.context), root = (await tx.get(caseRef)).data();
    const evidenceRef = caseRef.collection('evidence').doc(evidenceId(uid, requestId)), prior = await tx.get(evidenceRef);
    const alertRef = db.collection('admin_alerts').doc(`product_evidence_${evidenceId(uid, requestId)}`), alert = await tx.get(alertRef);
    if (prior.exists || alert.exists) throw new HttpsError('failed-precondition', 'Fichier ou alerte sans reçu à rapprocher.');
    const now = Timestamp.now(), notices = await prepareOperationalNotices(tx, [{eventKey: `product_evidence_v1:${evidenceId(uid, requestId)}`, userId: uid,
      type: 'product_review_update', title: 'Pièce privée enregistrée', message: neutralized
        ? 'Votre fichier est conservé pour examen. Une neutralisation bloque toute nouvelle adoption au dossier.' : matches
        ? 'Votre fichier a été reçu et lié à votre contribution. Son contenu et sa valeur de preuve restent à examiner.'
        : 'Votre fichier est conservé. Sa source a changé ou doit être rapprochée avant son adoption au dossier.',
      data: {ownerId: uid, productReviewCaseId: productReviewCaseId(command.context), contextKind: command.context.kind,
        contextId: command.context.id, productReviewEvidenceId: evidenceId(uid, requestId)}}]);
    const document = {protocol: 'product_review_evidence_v1', evidenceId: evidenceId(uid, requestId), caseId: productReviewCaseId(command.context),
      actorId: uid, requestId, command, adopted: matches, storageProof: stored!.proof, recordedAt: now,
      actorRole: value!.actorRole,
      imageDecodeVerified: false, issuerOriginalVerified: false, ...PRODUCT_REVIEW_EFFECTS};
    const hash = supportSourceHash(document), next = {...value!, state: matches ? 'received' : 'stored_requires_review',
      reason: matches ? null : neutralized ? 'future_effects_neutralized' : 'source_changed', storageProof: stored!.proof, evidenceHash: hash, recordedAt: now};
    tx.create(evidenceRef, {protocol: document.protocol, evidenceId: document.evidenceId, actorId: uid, document, contentHash: hash});
    tx.update(ref, next);
    if (root?.protocol === 'product_review_case_v1' && Number.isSafeInteger(root.version) && root.version >= 1 && root.version < Number.MAX_SAFE_INTEGER - 1)
      tx.update(caseRef, {version: root.version + 1, latestEvidenceAt: now, state: 'awaiting_review'});
    tx.create(alertRef, {kind: 'product_review', severity: 'warning', refId: document.caseId, status: 'open', createdAt: now,
      message: 'Pièce privée à examiner ; intégrité de bytes distincte d’authenticité, de sécurité et de responsabilité.',
      context: {caseId: document.caseId, contributionId: command.contributionId, evidenceId: document.evidenceId, adopted: matches}});
    notices.commit(); return next;
  });
  return view(uid, requestId, command, final);
  });
}

async function readerAuthority(tx: FirebaseFirestore.Transaction, request: any, uid: string) {
  const session = await assertPrivateAccountSession(request, tx);
  if (request.data.scope === 'admin') await supportAdmin(tx, uid, session.currentAdminClaim);
}
function evidenceView(document: any, contentHash: string) {
  return {protocol: 'product_review_evidence_v1', evidenceId: document.evidenceId, contentHash,
    actorId: document.actorId, actorRole: document.actorRole,
    contributionId: document.command.contributionId, typeDeclared: document.command.typeDeclared,
    state: document.adopted ? 'received' : 'stored_requires_review', sourceHash: document.command.sourceHash,
    recordedAt: document.recordedAt.toDate().toISOString(), generation: document.storageProof.generation,
    crc32c: document.storageProof.crc32c, sha256: document.storageProof.sha256,
    byteLength: document.storageProof.byteLength, contentType: document.storageProof.contentType,
    width: document.storageProof.width, height: document.storageProof.height,
    currentBlobAvailabilityVerified: false, imageDecodeVerified: false, issuerOriginalVerified: false, ...PRODUCT_REVIEW_EFFECTS};
}
export async function readProductReviewEvidence(request: any) {
  const uid = supportUid(request), raw = supportObject(request.data, ['operation', 'expectedUid', 'context', 'scope', 'cursor', 'materialCapability', 'parcelCapability']);
  if (productMaterialRequested(raw) && raw.context?.kind !== 'order') throw new HttpsError('invalid-argument', 'Commande native requise.');
  const context = productReviewContext(raw.context), cursor = raw.cursor == null ? null : supportObject(raw.cursor, ['lastId']).lastId;
  if (!['own', 'admin'].includes(raw.scope) || cursor !== null && !id(cursor)) throw new HttpsError('invalid-argument', 'Lecteur privé invalide.');
  return withPrivateAccountSession(request, async () => {
    const result = await db.runTransaction(async tx => {
      await readerAuthority(tx, request, uid);
      const ref = productReviewCaseRef(context), root = (await tx.get(ref)).data();
      if (root?.protocol !== 'product_review_case_v1' || root.caseId !== productReviewCaseId(context)) throw new HttpsError('failed-precondition', 'Dossier privé à rapprocher.');
      if (raw.scope === 'own' && !['buyerId', 'sellerId', 'reporterId'].some(r => root.nativeActors?.[r] === uid)) throw new HttpsError('permission-denied', 'Dossier non autorisé.');
      let query: FirebaseFirestore.Query = ref.collection('evidence');
      if (raw.scope === 'own') query = query.where('actorId', '==', uid);
      query = query.orderBy('__name__').limit(21);
      if (cursor) query = query.startAfter(cursor);
      const page = await tx.get(query), inspected = page.docs.slice(0, 20), entries = [];
      for (const snap of inspected) {
        const proof = await readProductReviewEvidenceProof(tx, context, snap.id, snap.data());
        entries.push(proof && (raw.scope === 'admin' || proof.document.actorId === uid)
          ? {qualification: 'native_stored_file', evidence: evidenceView(proof.document, snap.data().contentHash)}
          : {qualification: 'unknown', evidenceId: snap.id, evidence: null});
      }
      return {protocol: 'product_review_evidence_page_v1', actorId: uid, scope: raw.scope, caseId: productReviewCaseId(context), entries,
        nextCursor: page.size > 20 ? {lastId: inspected.at(-1)!.id} : null, readAt: Timestamp.now().toDate().toISOString(),
        coverage: {inspected: inspected.length, limit: 20, hasMore: page.size > 20, exhaustiveHistoryVerified: false},
        otherActorsOriginalsVisible: raw.scope === 'admin', ...PRODUCT_REVIEW_EFFECTS};
    });
    await db.runTransaction(tx => readerAuthority(tx, request, uid));
    return result;
  });
}
export async function readProductReviewEvidenceFile(request: any) {
  const uid = supportUid(request), raw = supportObject(request.data, ['operation', 'expectedUid', 'context', 'scope', 'evidenceId', 'expectedEvidenceHash', 'materialCapability', 'parcelCapability']);
  if (productMaterialRequested(raw) && raw.context?.kind !== 'order') throw new HttpsError('invalid-argument', 'Commande native requise.');
  const context = productReviewContext(raw.context);
  if (!['own', 'admin'].includes(raw.scope) || typeof raw.evidenceId !== 'string' || !/^pf_[a-f0-9]{64}$/.test(raw.evidenceId) || !HASH.test(raw.expectedEvidenceHash ?? ''))
    throw new HttpsError('invalid-argument', 'Fichier et version privés exacts requis.');
  const read = () => db.runTransaction(async tx => {
    await readerAuthority(tx, request, uid);
    const record = (await tx.get(productReviewCaseRef(context).collection('evidence').doc(raw.evidenceId))).data();
    const proof = await readProductReviewEvidenceProof(tx, context, raw.evidenceId, record);
    if (!proof || record!.contentHash !== raw.expectedEvidenceHash) throw new HttpsError('failed-precondition', 'Reçu privé non qualifié.');
    if (raw.scope === 'own' && proof.document.actorId !== uid) throw new HttpsError('permission-denied', 'Original d’un autre acteur non autorisé.');
    return proof;
  });
  return withPrivateAccountSession(request, async () => {
    const original = await read(), stored = await observeStored(original.command, original.document.actorId, original.document.requestId, original.document.storageProof.generation);
    if (stored.proof.generation !== original.document.storageProof.generation || stored.proof.crc32c !== original.document.storageProof.crc32c)
      throw new HttpsError('failed-precondition', 'Génération originale indisponible ou modifiée.');
    await read(); // Requalify native actor/receipt and current operator after Storage IO.
    return {protocol: 'product_review_evidence_file_v1', actorId: uid, evidenceId: raw.evidenceId, contentHash: raw.expectedEvidenceHash,
      dataUrl: `data:image/jpeg;base64,${stored.bytes.toString('base64')}`, generation: stored.proof.generation,
      crc32c: stored.proof.crc32c, sha256: stored.proof.sha256, imageDecodeVerified: false, issuerOriginalVerified: false, ...PRODUCT_REVIEW_EFFECTS};
  });
}
