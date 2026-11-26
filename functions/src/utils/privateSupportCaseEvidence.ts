/** Private immutable JPEGs for a human support review. No download token or
 * signed URL is created. Only the existing guarded callables read the bytes. */
import {createHash} from 'node:crypto';
import {HttpsError} from 'firebase-functions/v2/https';
import {storage} from '../config/firebase';
import {supportHash, supportObject, supportAccountUid, supportId, supportRequestId} from './supportRequest';

const MAX_BYTES = 5 * 1024 * 1024;
const digest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const generation = (value: unknown): value is string => typeof value === 'string' && /^[1-9][0-9]{0,24}$/.test(value);
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const fail = (): never => {throw new HttpsError('failed-precondition', 'La pièce privée doit être relue depuis sa source native.');};
export type PrivateSupportEvidenceRef = {evidenceId: string; generation: string; sha256: string; sizeBytes: number};
export type PrivateSupportEvidence = PrivateSupportEvidenceRef & {protocol: 'private_support_evidence_v1';
  supportRequestId: string; actorUid: string; requestId: string; objectPath: string; contentType: 'image/jpeg'; storageHold?: 'temporary_hold'};

export function privateSupportEvidenceRef(raw: unknown): PrivateSupportEvidenceRef {
  const item = supportObject(raw, ['evidenceId', 'generation', 'sha256', 'sizeBytes']);
  if (!/^spe_[a-f0-9]{64}$/.test(item.evidenceId ?? '') || !generation(item.generation) || !digest(item.sha256) ||
      !Number.isSafeInteger(item.sizeBytes) || item.sizeBytes < 4 || item.sizeBytes > MAX_BYTES) return fail();
  return {evidenceId: item.evidenceId, generation: item.generation, sha256: item.sha256, sizeBytes: item.sizeBytes};
}
function jpeg(bytes: Buffer) {
  if (bytes.length < 4 || bytes.length > MAX_BYTES || bytes[0] !== 0xff || bytes[1] !== 0xd8 ||
      bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) {
    throw new HttpsError('invalid-argument', 'Une image JPEG privée de 5 Mo maximum est requise.');
  }
}
function source(raw: PrivateSupportEvidence) {
  if (!raw || supportAccountUid(raw.actorUid) !== raw.actorUid || supportId(raw.supportRequestId) !== raw.supportRequestId ||
      supportRequestId(raw.requestId) !== raw.requestId) return fail();
  const reference = privateSupportEvidenceRef({evidenceId: raw.evidenceId, generation: raw.generation, sha256: raw.sha256, sizeBytes: raw.sizeBytes});
  const expectedId = 'spe_' + supportHash([raw.supportRequestId, raw.actorUid, raw.requestId]);
  if (raw.protocol !== 'private_support_evidence_v1' || reference.evidenceId !== expectedId || raw.contentType !== 'image/jpeg' ||
      raw.storageHold !== undefined && raw.storageHold !== 'temporary_hold' ||
      raw.objectPath !== `private-support-evidence/${supportHash(raw.supportRequestId)}/${expectedId}.jpg`) return fail();
  return reference;
}
export async function readPrivateSupportCaseJpeg(record: PrivateSupportEvidence): Promise<Buffer> {
  source(record);
  const file = storage.bucket().file(record.objectPath, {generation: record.generation});
  const [metadata] = await file.getMetadata();
  if (String(metadata.generation) !== record.generation || metadata.contentType !== 'image/jpeg' ||
      Number(metadata.size) !== record.sizeBytes || metadata.metadata?.supportEvidenceSha256 !== record.sha256 ||
      record.storageHold === 'temporary_hold' && metadata.temporaryHold !== true ||
      metadata.metadata?.supportEvidenceId !== record.evidenceId || metadata.metadata?.firebaseStorageDownloadTokens != null) return fail();
  const [bytes] = await file.download({validation: 'crc32c'});
  jpeg(bytes);
  if (bytes.length !== record.sizeBytes || sha(bytes) !== record.sha256) return fail();
  return bytes;
}
export async function savePrivateSupportCaseJpeg(supportRequestId: string, actorUid: string, requestId: string,
  encoded: unknown, options: {temporaryHold?: boolean} = {}): Promise<PrivateSupportEvidence> {
  const bytes = privateSupportJpegInput(encoded);
  const evidenceId = 'spe_' + supportHash([supportRequestId, actorUid, requestId]), sha256 = sha(bytes);
  const objectPath = `private-support-evidence/${supportHash(supportRequestId)}/${evidenceId}.jpg`;
  const file = storage.bucket().file(objectPath);
  try {
    await file.save(bytes, {resumable: false, validation: 'crc32c', preconditionOpts: {ifGenerationMatch: 0},
      metadata: {contentType: 'image/jpeg', cacheControl: 'private, max-age=0, no-store', ...(options.temporaryHold ? {temporaryHold: true} : {}),
        metadata: {supportEvidenceId: evidenceId, supportEvidenceSha256: sha256}}});
  } catch (error) {
    // A lost POST response is recovered only from the exact create-only native
    // object below. Never overwrite it or manufacture a successful upload.
    try {await file.getMetadata();} catch {throw error;}
  }
  const [metadata] = await file.getMetadata(), nativeGeneration = String(metadata.generation);
  if (!generation(nativeGeneration)) return fail();
  const record: PrivateSupportEvidence = {protocol: 'private_support_evidence_v1', supportRequestId, actorUid, requestId,
    evidenceId, objectPath, generation: nativeGeneration, sha256, sizeBytes: bytes.length, contentType: 'image/jpeg',
    ...(options.temporaryHold ? {storageHold: 'temporary_hold' as const} : {})};
  await readPrivateSupportCaseJpeg(record);
  return record;
}
function privateSupportJpegInput(encoded: unknown) {
  if (typeof encoded !== 'string' || encoded.length > Math.ceil(MAX_BYTES / 3) * 4 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
    throw new HttpsError('invalid-argument', 'Encodage JPEG privé invalide.');
  }
  const bytes = Buffer.from(encoded, 'base64');
  jpeg(bytes);
  return bytes;
}
export const privateSupportJpegSha256 = (encoded: unknown) => sha(privateSupportJpegInput(encoded));
