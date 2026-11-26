/** Public access-help intake. Possession of the random recovery capability
 * permits observation of one opaque receipt, never access to an account.
 * Contact/narrative are declarations for a human operator, not identity proof. */
import { createHash, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { Timestamp } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db } from '../config/firebase';
import { assertPrivateAccountSession, withPrivateAccountSession } from '../utils/privateAccountSession';
import { supportAdmin } from '../utils/supportRequest';

const PROTOCOL = 'account_access_intake_v1';
const COLLECTION = 'account_access_intake';
const MODES = ['submit', 'observe', 'neutralize'] as const;
type PublicMode = typeof MODES[number];
interface Command { replyEmail: string; narrative: string }
interface PublicInput { mode: PublicMode; requestId: string; recoverySecret: string; command: Command }
const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const invalid = () => new HttpsError('invalid-argument', 'Demande invalide.');
const unavailable = () => new HttpsError('failed-precondition', 'Cette référence ne peut pas être reprise avec les renseignements fournis.');
function object(value: unknown, fields: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !fields.includes(k))) throw invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) throw invalid();
  return value.trim();
}
function publicInput(raw: unknown): PublicInput {
  const data = object(raw, ['mode', 'requestId', 'recoverySecret', 'command']);
  if (!(MODES as readonly unknown[]).includes(data.mode) || typeof data.requestId !== 'string' ||
      !/^[A-Za-z0-9_-]{16,128}$/.test(data.requestId) || typeof data.recoverySecret !== 'string' ||
      !/^[a-f0-9]{64}$/.test(data.recoverySecret)) throw invalid();
  const command = object(data.command, ['replyEmail', 'narrative']);
  const replyEmail = text(command.replyEmail, 320), narrative = text(command.narrative, 4000);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(replyEmail) || Buffer.byteLength(narrative, 'utf8') > 12_000) throw invalid();
  return { mode: data.mode as PublicMode, requestId: data.requestId, recoverySecret: data.recoverySecret,
    command: { replyEmail, narrative } };
}
function commandHash(data: PublicInput): string { return sha([PROTOCOL, data.requestId, data.command.replyEmail, data.command.narrative]); }
function reference(requestId: string): string { return 'access_' + sha([PROTOCOL, requestId]); }
function secretHash(secret: string): string { return createHash('sha256').update(secret, 'utf8').digest('hex'); }
function sameSecret(stored: unknown, supplied: string): boolean {
  return typeof stored === 'string' && /^[a-f0-9]{64}$/.test(stored) &&
    timingSafeEqual(Buffer.from(stored, 'hex'), Buffer.from(secretHash(supplied), 'hex'));
}
/** Use only the transport socket observed by the runtime. A reverse proxy can
 * make many callers share this bucket. It is an abuse limit, not user identity;
 * neither a client-forwarded header nor a declared contact sets the key. */
function networkKey(request: { rawRequest?: { socket?: { remoteAddress?: string } } }): string {
  const raw = request.rawRequest?.socket?.remoteAddress;
  const endpoint = typeof raw === 'string' && isIP(raw) ? raw : 'transport_endpoint_unavailable';
  return sha(['account_access_intake_transport_endpoint_v1', endpoint]);
}
interface Quota { key: string; max: number; windowMs: number }
async function readQuota(tx: FirebaseFirestore.Transaction, spec: Quota, nowMs: number) {
  const ref = db.collection('rate_limits').doc('access_intake_' + spec.key), old = (await tx.get(ref)).data();
  if (old && (old.protocol !== PROTOCOL || !Number.isSafeInteger(old.windowStartedAtMs) || old.windowStartedAtMs < 1 ||
      old.windowStartedAtMs > nowMs + 60_000 || !Number.isSafeInteger(old.count) || old.count < 1)) throw new HttpsError('resource-exhausted',
    'Le service de réception est temporairement indisponible. Réessayez plus tard.');
  const inWindow = !!old && old.windowStartedAtMs > nowMs - spec.windowMs;
  const count = inWindow ? old!.count : 0;
  if (count >= spec.max) throw new HttpsError('resource-exhausted', 'Trop de demandes. Conservez votre référence et réessayez plus tard.');
  return () => tx.set(ref, { protocol: PROTOCOL, windowStartedAtMs: inWindow ? old!.windowStartedAtMs : nowMs,
    count: count + 1, context: 'abuse_limit_not_identity' });
}
function nativeRecord(data: FirebaseFirestore.DocumentData | undefined, id: string) {
  if (!data || data.protocol !== PROTOCOL || data.reference !== id || typeof data.requestId !== 'string' ||
      reference(data.requestId) !== id || !['received', 'neutralized'].includes(data.state) ||
      !(data.recordedAt instanceof Timestamp) || !Number.isSafeInteger(data.recordedAtMs) ||
      data.recordedAt.toMillis() !== data.recordedAtMs || typeof data.payloadHash !== 'string' || !/^[a-f0-9]{64}$/.test(data.payloadHash) ||
      typeof data.recoverySecretHash !== 'string' || !/^[a-f0-9]{64}$/.test(data.recoverySecretHash)) throw unavailable();
  if (data.state === 'received') {
    const command = data.command;
    if (!command || typeof command.replyEmail !== 'string' || typeof command.narrative !== 'string' ||
        sha([PROTOCOL, data.requestId, command.replyEmail, command.narrative]) !== data.payloadHash ||
        data.contactVerified !== false || data.identityVerified !== false || data.recoveryGranted !== false) throw unavailable();
  } else if (data.sourceExamined !== false || data.command != null) throw unavailable();
  return data;
}
function publicReceipt(data: PublicInput, id: string, record?: FirebaseFirestore.DocumentData) {
  return { protocol: PROTOCOL, requestId: data.requestId, reference: id, payloadHash: commandHash(data),
    state: record?.state ?? 'unrecorded', recordedAt: record?.recordedAt instanceof Timestamp ? record.recordedAt.toDate().toISOString() : null,
    contactVerified: false, identityVerified: false, recoveryGranted: false };
}
function adminReceipt(id: string, record: FirebaseFirestore.DocumentData) {
  const data = nativeRecord(record, id);
  return { protocol: PROTOCOL, reference: id, requestId: data.requestId, payloadHash: data.payloadHash,
    state: data.state, recordedAt: data.recordedAt.toDate().toISOString(),
    command: data.state === 'received' ? { replyEmail: data.command.replyEmail, narrative: data.command.narrative } : null,
    contactVerified: false, identityVerified: false, recoveryGranted: false };
}
/** Current Auth existence/status plus a role protected in users rules. The
 * previously issued JWT's administrative claim never grants this reader. */
async function currentAdmin(request: any, tx: FirebaseFirestore.Transaction): Promise<string> {
  if (!request.auth || request.data?.expectedUid !== request.auth.uid) throw new HttpsError('permission-denied', 'Accès administratif requis.');
  const session = await assertPrivateAccountSession(request, tx);
  await supportAdmin(tx, session.uid, session.currentAdminClaim);
  return session.uid;
}
async function adminRead(request: any) {
  const data = object(request.data, ['mode', 'expectedUid', 'reference', 'cursor']);
  const detail = data.mode === 'admin_detail';
  if (detail && data.cursor != null || !detail && data.reference != null) throw invalid();
  if (detail && (typeof data.reference !== 'string' || !/^access_[a-f0-9]{64}$/.test(data.reference))) throw invalid();
  if (!detail && data.cursor != null && (typeof data.cursor !== 'string' || !/^access_[a-f0-9]{64}$/.test(data.cursor))) throw invalid();
  return withPrivateAccountSession(request, async () => {
    const result = await db.runTransaction(async tx => {
      const uid = await currentAdmin(request, tx);
      const consume = await readQuota(tx, { key: 'admin_' + sha(uid), max: 30, windowMs: 60_000 }, Date.now());
      if (detail) {
        const snap = await tx.get(db.collection(COLLECTION).doc(data.reference as string));
        if (!snap.exists) throw new HttpsError('not-found', 'Référence introuvable.');
        const item = adminReceipt(snap.id, snap.data()!); consume();
        return { protocol: PROTOCOL, scope: 'admin', item, accountSearchPerformed: false, recoveryGranted: false };
      }
      let query = db.collection(COLLECTION).orderBy('__name__', 'asc').limit(31);
      if (data.cursor) query = query.startAfter(data.cursor);
      const page = await tx.get(query), docs = page.docs.slice(0, 30), hasMore = page.size > 30;
      const items = docs.map(doc => adminReceipt(doc.id, doc.data())); consume();
      return { protocol: PROTOCOL, scope: 'admin', items, hasMore, cursor: hasMore ? docs.at(-1)!.id : null,
        accountSearchPerformed: false, recoveryGranted: false };
    });
    // The page must not escape after containment, revocation or role removal
    // during the private document reads. Public intake never enters this path.
    await db.runTransaction(tx => currentAdmin(request, tx));
    return result;
  });
}

export const accountAccessIntake = onCall({ region: 'northamerica-northeast1', memory: '512MiB' }, async request => {
  const isAdminMode = request.data?.mode === 'admin_list' || request.data?.mode === 'admin_detail';
  // Parse cheap public inputs before DB work. Administrative Auth/role checks
  // follow the transport/global quota too, so non-admin probes are bounded.
  const data = isAdminMode ? null : publicInput(request.data);
  const network = networkKey(request);
  await db.runTransaction(async tx => {
    const nowMs = Date.now();
    const mode = data?.mode ?? 'admin';
    const consumeNetwork = await readQuota(tx, { key: 'network_' + network + '_' + mode,
      max: mode === 'observe' || mode === 'admin' ? 30 : 8, windowMs: 60_000 }, nowMs);
    const consumeGlobalCalls = await readQuota(tx, { key: 'global_calls', max: 600, windowMs: 60_000 }, nowMs);
    consumeNetwork(); consumeGlobalCalls();
  });
  if (isAdminMode) return adminRead(request);
  const input = data!, id = reference(input.requestId), ref = db.collection(COLLECTION).doc(id);
  return db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (snap.exists) {
      const record = nativeRecord(snap.data(), id);
      if (!sameSecret(record.recoverySecretHash, input.recoverySecret) || record.requestId !== input.requestId || record.payloadHash !== commandHash(input)) throw unavailable();
      // Already received is prior to neutralization. No caller can delete a
      // human intake or read its contents with this receipt capability.
      return publicReceipt(input, id, record);
    }
    if (input.mode === 'observe') {
      return publicReceipt(input, id);
    }
    const consumeCreations = await readQuota(tx, { key: 'global_creations', max: 200, windowMs: 60 * 60_000 }, Date.now());
    const recordedAt = Timestamp.now();
    const record = { protocol: PROTOCOL, reference: id, requestId: input.requestId, payloadHash: commandHash(input),
      recoverySecretHash: secretHash(input.recoverySecret), state: input.mode === 'submit' ? 'received' : 'neutralized',
      recordedAt, recordedAtMs: recordedAt.toMillis(), contactVerified: false, identityVerified: false, recoveryGranted: false,
      ...(input.mode === 'submit' ? { command: input.command } : { sourceExamined: false }) };
    tx.create(ref, record); consumeCreations();
    return publicReceipt(input, id, record);
  });
});
