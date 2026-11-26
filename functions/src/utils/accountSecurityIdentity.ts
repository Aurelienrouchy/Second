/** Immutable original-identity evidence and native recovery qualification.
 * Fingerprints alone never grant recovery: the current transaction must join
 * the original episode, receipt, monotone witness and current Auth record. */
import { createHash } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { auth, db } from '../config/firebase';
import { accountSecurityQualifiedProjection } from '../shared/accountSecurity';

const ORIGIN = 'account_security_identity_origin_v1';
const CLAIM = 'account_security_identity_observation_claim_v1';
const BASELINE = 'account_security_identity_baseline_v1';
type Provider = 'google.com' | 'apple.com' | 'password';
type Fingerprint = { providerId: Provider; subjectHash: string };
export interface AccountSecurityIdentityBinding {
  uid: string; commandId: string; inputHash: string; receivedAt: Timestamp;
}
interface Origin {
  protocol: typeof ORIGIN; bindingHash: string;
  qualification: 'known_subset' | 'baseline_unknown'; reason: string | null;
  authTimeSeconds: number | null; issuedAtSeconds: number | null;
  signInProvider: Provider | null; passwordEmailVerified: boolean | null; identities: Fingerprint[]; sourceHash: string;
}
interface Claim { protocol: typeof CLAIM; bindingHash: string; originHash: string;
  attemptId: string; claimedAt: Timestamp; claimHash: string }
interface Baseline {
  protocol: typeof BASELINE; bindingHash: string; originHash: string | null; claimHash: string | null;
  qualification: 'known_subset' | 'baseline_unknown'; reason: string | null;
  observedAt: Timestamp; observation: 'first_pre_revocation_auth_snapshot' | 'unavailable';
  nativeCutoffMs: number | null; nativeProviderSetHash: string | null;
  nativePasswordEmailVerified: boolean | null;
  identities: Fingerprint[]; exhaustive: false; recoveryPermissionGranted: false; sourceHash: string;
}
const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const object = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const digest = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const provider = (v: unknown): v is Provider => v === 'google.com' || v === 'apple.com' || v === 'password';
const subject = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 1024;
const seconds = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0;
const clock = (t: Timestamp) => [t.seconds, t.nanoseconds];
const before = (a: Timestamp, b: Timestamp) => a.seconds < b.seconds ||
  a.seconds === b.seconds && a.nanoseconds < b.nanoseconds;
const bindingHash = (b: AccountSecurityIdentityBinding) =>
  hash(['account_security_identity_binding_v1', b.uid, b.commandId, b.inputHash, clock(b.receivedAt)]);
const fingerprint = (uid: string, providerId: Provider, value: string): Fingerprint =>
  ({ providerId, subjectHash: hash(['account_security_identity_subject_v1', uid, providerId, value]) });
const sorted = (v: Fingerprint[]) => v.sort((a, b) => a.providerId < b.providerId ? -1 : a.providerId > b.providerId ? 1 :
  a.subjectHash < b.subjectHash ? -1 : a.subjectHash > b.subjectHash ? 1 : 0);
const identityPayload = (v: Fingerprint[]) => v.map(x => [x.providerId, x.subjectHash]);
const fingerprintsValid = (v: unknown): v is Fingerprint[] => Array.isArray(v) && v.length <= 17 &&
  v.every(x => object(x) && Object.keys(x).length === 2 && provider(x.providerId) && digest(x.subjectHash)) &&
  v.every((x, i) => i === 0 || v[i - 1].providerId < x.providerId ||
    v[i - 1].providerId === x.providerId && v[i - 1].subjectHash < x.subjectHash);
const originPayload = (v: Omit<Origin, 'sourceHash'>) => [v.protocol, v.bindingHash, v.qualification, v.reason,
  v.authTimeSeconds, v.issuedAtSeconds, v.signInProvider, v.passwordEmailVerified, identityPayload(v.identities)];
const claimPayload = (v: Omit<Claim, 'claimHash'>) => [v.protocol, v.bindingHash, v.originHash, v.attemptId, clock(v.claimedAt)];
const baselinePayload = (v: Omit<Baseline, 'sourceHash'>) => [v.protocol, v.bindingHash, v.originHash, v.claimHash,
  v.qualification, v.reason, clock(v.observedAt), v.observation, v.nativeCutoffMs, v.nativeProviderSetHash,
  v.nativePasswordEmailVerified, identityPayload(v.identities), v.exhaustive, v.recoveryPermissionGranted];

/** Called only for a new execute command, with the original callable token. */
export function captureAccountSecurityIdentityOrigin(token: unknown, b: AccountSecurityIdentityBinding): Origin {
  const unknown = (reason: string): Origin => {
    const v: Omit<Origin, 'sourceHash'> = { protocol: ORIGIN, bindingHash: bindingHash(b),
      qualification: 'baseline_unknown', reason, authTimeSeconds: null, issuedAtSeconds: null,
      signInProvider: null, passwordEmailVerified: null, identities: [] };
    return { ...v, sourceHash: hash(originPayload(v)) };
  };
  const t = object(token), fb = object(t?.firebase), identities = object(fb?.identities);
  if (!t || t.sub !== b.uid || own(t, 'uid') && t.uid !== b.uid || !fb || !identities ||
      !provider(fb.sign_in_provider) || !seconds(t.auth_time) || !seconds(t.iat) ||
      t.auth_time > t.iat || t.iat > b.receivedAt.seconds || Object.keys(identities).length > 16) {
    return unknown('original_signed_identity_unqualified');
  }
  const candidates: Fingerprint[] = [];
  for (const id of ['google.com', 'apple.com'] as const) {
    if (!own(identities, id)) continue;
    const values = identities[id];
    if (!Array.isArray(values) || values.length === 0 || values.length > 8 || !values.every(subject) ||
        new Set(values).size !== values.length) return unknown('original_provider_namespace_unqualified');
    candidates.push(...values.map(value => fingerprint(b.uid, id, value)));
  }
  // An OAuth token's email namespace is not evidence that password was linked.
  if (fb.sign_in_provider === 'password') {
    const emails = identities.email;
    if (typeof t.email_verified !== 'boolean' || !subject(t.email) || !Array.isArray(emails) ||
        emails.length !== 1 || emails[0] !== t.email) return unknown('original_password_identity_unqualified');
    candidates.push(fingerprint(b.uid, 'password', t.email));
  }
  if (!candidates.some(x => x.providerId === fb.sign_in_provider)) return unknown('original_sign_in_identity_missing');
  const v: Omit<Origin, 'sourceHash'> = { protocol: ORIGIN, bindingHash: bindingHash(b),
    qualification: 'known_subset', reason: null, authTimeSeconds: t.auth_time, issuedAtSeconds: t.iat,
    signInProvider: fb.sign_in_provider, passwordEmailVerified: fb.sign_in_provider === 'password' ? t.email_verified as boolean : null,
    identities: sorted(candidates) };
  return { ...v, sourceHash: hash(originPayload(v)) };
}

function origin(value: unknown, b: AccountSecurityIdentityBinding): Origin | null {
  const v = object(value);
  if (!v || v.protocol !== ORIGIN || v.bindingHash !== bindingHash(b) || !digest(v.sourceHash) ||
      !fingerprintsValid(v.identities) || !['known_subset', 'baseline_unknown'].includes(v.qualification as string)) return null;
  if (v.qualification === 'known_subset' && (v.reason !== null || !seconds(v.authTimeSeconds) ||
      !seconds(v.issuedAtSeconds) || v.authTimeSeconds > v.issuedAtSeconds || v.issuedAtSeconds > b.receivedAt.seconds ||
      !provider(v.signInProvider) || !v.identities.some(x => x.providerId === v.signInProvider) ||
      v.identities.some(x => x.providerId === 'password') !== (v.signInProvider === 'password') ||
      (v.signInProvider === 'password' ? typeof v.passwordEmailVerified !== 'boolean' : v.passwordEmailVerified !== null))) return null;
  if (v.qualification === 'baseline_unknown' && (typeof v.reason !== 'string' || v.authTimeSeconds !== null ||
      v.issuedAtSeconds !== null || v.signInProvider !== null || v.passwordEmailVerified !== null || v.identities.length !== 0)) return null;
  return hash(originPayload(v as unknown as Origin)) === v.sourceHash ? v as unknown as Origin : null;
}

export function claimAccountSecurityIdentityObservation(value: unknown, b: AccountSecurityIdentityBinding,
  attemptId: string, claimedAt: Timestamp): Claim | null {
  const source = origin(value, b);
  if (!source) return null;
  const v: Omit<Claim, 'claimHash'> = { protocol: CLAIM, bindingHash: bindingHash(b), originHash: source.sourceHash, attemptId, claimedAt };
  return { ...v, claimHash: hash(claimPayload(v)) };
}
export function accountSecurityIdentityClaimMatches(value: unknown, source: unknown,
  b: AccountSecurityIdentityBinding, attemptId: string): boolean {
  const v = object(value), o = origin(source, b);
  return !!(v && o && v.protocol === CLAIM && v.bindingHash === bindingHash(b) && v.originHash === o.sourceHash &&
    typeof v.attemptId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v.attemptId) && v.attemptId === attemptId &&
    v.claimedAt instanceof Timestamp && !before(v.claimedAt, b.receivedAt) &&
    digest(v.claimHash) && hash(claimPayload(v as unknown as Claim)) === v.claimHash);
}

export function unknownAccountSecurityIdentityBaseline(b: AccountSecurityIdentityBinding, source: unknown,
  claim: unknown, reason: string, observedAt: Timestamp): Baseline {
  const o = origin(source, b), c = object(claim);
  const v: Omit<Baseline, 'sourceHash'> = { protocol: BASELINE, bindingHash: bindingHash(b),
    originHash: o?.sourceHash ?? null, claimHash: c && digest(c.claimHash) ? c.claimHash : null,
    qualification: 'baseline_unknown', reason, observedAt, observation: 'unavailable',
    nativeCutoffMs: null, nativeProviderSetHash: null, nativePasswordEmailVerified: null,
    identities: [], exhaustive: false, recoveryPermissionGranted: false };
  return { ...v, sourceHash: hash(baselinePayload(v)) };
}

/** Snapshot immediately after the existing first getUser response, before any
 * await. A provider added later cannot enter the original-token intersection. */
export function qualifyAccountSecurityIdentityBaseline(b: AccountSecurityIdentityBinding, source: unknown,
  claim: unknown, attemptId: string, record: unknown, observedAt: Timestamp): Baseline {
  const o = origin(source, b), c = object(claim), n = object(record);
  const unknown = (reason: string) => unknownAccountSecurityIdentityBaseline(b, source, claim, reason, observedAt);
  if (!o || !accountSecurityIdentityClaimMatches(claim, source, b, attemptId)) return unknown('original_observation_claim_unqualified');
  if (o.qualification !== 'known_subset') return unknown('original_signed_identity_unqualified');
  if (!n || n.uid !== b.uid || n.disabled !== false || before(observedAt, b.receivedAt) ||
      before(observedAt, c!.claimedAt as Timestamp) || !Array.isArray(n.providerData) || n.providerData.length > 16) {
    return unknown('native_auth_snapshot_unqualified');
  }
  const cutoffMs = typeof n.tokensValidAfterTime === 'string' ? Date.parse(n.tokensValidAfterTime) : NaN;
  if (!Number.isSafeInteger(cutoffMs) || cutoffMs < 0 || cutoffMs > observedAt.toMillis() ||
      o.authTimeSeconds! * 1000 < cutoffMs) return unknown('original_auth_cutoff_unqualified');
  const native: Fingerprint[] = [], seen = new Set<string>();
  for (const raw of n.providerData) {
    const p = object(raw);
    if (!p || typeof p.providerId !== 'string' || !subject(p.providerId) || !subject(p.uid) || seen.has(p.providerId)) {
      return unknown('native_provider_data_unqualified');
    }
    seen.add(p.providerId);
    if (!provider(p.providerId)) continue;
    if (p.providerId === 'password' && (typeof n.emailVerified !== 'boolean' || !subject(n.email) || p.uid !== n.email ||
        own(p, 'email') && p.email !== n.email)) continue;
    native.push(fingerprint(b.uid, p.providerId, p.uid));
  }
  const identities = o.identities.filter(x => native.some(y => x.providerId === y.providerId && x.subjectHash === y.subjectHash));
  if (identities.length === 0) return unknown('original_native_identity_intersection_empty');
  const v: Omit<Baseline, 'sourceHash'> = { protocol: BASELINE, bindingHash: bindingHash(b), originHash: o.sourceHash,
    claimHash: c!.claimHash as string, qualification: 'known_subset', reason: null, observedAt,
    observation: 'first_pre_revocation_auth_snapshot', nativeCutoffMs: cutoffMs, nativeProviderSetHash: hash(identityPayload(sorted(native))),
    nativePasswordEmailVerified: identities.some(x => x.providerId === 'password') ? n.emailVerified as boolean : null,
    identities, exhaustive: false, recoveryPermissionGranted: false };
  return { ...v, sourceHash: hash(baselinePayload(v)) };
}

/** Private diagnostic projection, deliberately not a recovery policy/DTO. */
export function accountSecurityIdentityBaselineQualification(command: Record<string, unknown>, b: AccountSecurityIdentityBinding): 'known_subset' | 'baseline_unknown' {
  const v = object(command.identityBaseline), o = origin(command.identityOrigin, b), claim = object(command.identityObservationClaim);
  if (!v || !o || !claim || !accountSecurityIdentityClaimMatches(claim, o, b, claim.attemptId as string) ||
      v.protocol !== BASELINE || v.bindingHash !== bindingHash(b) || v.originHash !== o.sourceHash ||
      v.claimHash !== claim.claimHash || v.qualification !== 'known_subset' || o.qualification !== 'known_subset' ||
      !(v.observedAt instanceof Timestamp) || before(v.observedAt, claim.claimedAt as Timestamp) ||
      v.observation !== 'first_pre_revocation_auth_snapshot' || v.reason !== null || !digest(v.nativeProviderSetHash) ||
      !Number.isSafeInteger(v.nativeCutoffMs) || (v.nativeCutoffMs as number) < 0 ||
      (v.nativeCutoffMs as number) > v.observedAt.toMillis() || o.authTimeSeconds! * 1000 < (v.nativeCutoffMs as number) ||
      !fingerprintsValid(v.identities) || v.identities.length === 0 || !v.identities.every(x =>
        o.identities.some(y => x.providerId === y.providerId && x.subjectHash === y.subjectHash)) ||
      (v.identities.some(x => x.providerId === 'password') ? typeof v.nativePasswordEmailVerified !== 'boolean' : v.nativePasswordEmailVerified !== null) ||
      v.exhaustive !== false || v.recoveryPermissionGranted !== false || !digest(v.sourceHash) ||
      hash(baselinePayload(v as unknown as Baseline)) !== v.sourceHash) return 'baseline_unknown';
  return 'known_subset';
}

export const ACCOUNT_SECURITY_RECOVERY_VERSION = 'account_security_recovery_v1';
export const ACCOUNT_SECURITY_RECOVERY_STATEMENT = 'Je confirme avoir sécurisé les moyens de connexion liés à mon compte et demande de reprendre les nouvelles opérations. Cette déclaration ne prouve pas un changement de mot de passe chez Google ou Apple.';
const CONTAINMENT_VERSION = 'account_security_containment_v1';
const CONTAINMENT_STATEMENT = 'Je demande de bloquer les nouvelles opérations de ce compte et de révoquer ses sessions. Le rétablissement nécessitera un examen par l’équipe.';
const rid = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v);
const time = (v: unknown): v is Timestamp => v instanceof Timestamp && v.toMillis() > 0 && v.toMillis() <= Date.now();
const equalTime = (a: unknown, b: unknown) => time(a) && time(b) && a.isEqual(b);
export const accountSecurityRecoveryCommandId = (uid: string, requestId: string) => 'recovery_' + hash([uid, requestId]);
export type AccountSecurityRecoveryProof = {
  episodeHash: string; baselineHash: string; nativeCutoffMs: number; nativeProviderSetHash: string;
  providerId: Provider; subjectHash: string; authTimeSeconds: number;
  /** Source revision only, never an assertion that old credentials rotated. */
  previousReceiptHash?: string;
  previousStateHash?: string;
};
export interface AccountSecurityRecoveryCommand {
  schemaVersion: 1; action: 'account_security_recovery'; ownerId: string; actorUid: string;
  commandId: string; requestId: string; inputHash: string; episodeId: string; sourceHash: string;
  statementVersion: typeof ACCOUNT_SECURITY_RECOVERY_VERSION; statement: typeof ACCOUNT_SECURITY_RECOVERY_STATEMENT;
  accepted: true; state: 'restored' | 'neutralized'; receivedAt: Timestamp;
  restoration: AccountSecurityRecoveryProof | null; receiptHash: string;
}
export const accountSecurityRecoveryInputHash = (uid: string, data: {
  requestId: string; expectedEpisodeId: string; expectedSourceHash: string;
}) => hash([uid, data.requestId, ACCOUNT_SECURITY_RECOVERY_VERSION, true, data.expectedEpisodeId, data.expectedSourceHash]);
const proofPayload = (p: AccountSecurityRecoveryProof | null) => p === null ? null :
  [p.episodeHash, p.baselineHash, p.nativeCutoffMs, p.nativeProviderSetHash, p.providerId, p.subjectHash, p.authTimeSeconds,
    ...own(p,'previousReceiptHash') ? [p.previousReceiptHash,p.previousStateHash] : []];
const recoveryReceiptPayload = (v: Omit<AccountSecurityRecoveryCommand, 'receiptHash'>) =>
  [v.schemaVersion, v.action, v.ownerId, v.actorUid, v.commandId, v.requestId, v.inputHash, v.episodeId,
    v.sourceHash, v.statementVersion, v.statement, v.accepted, v.state, clock(v.receivedAt), proofPayload(v.restoration)];
export function accountSecurityRecoveryReceipt(body: Omit<AccountSecurityRecoveryCommand, 'receiptHash'>): AccountSecurityRecoveryCommand {
  return { ...body, receiptHash: hash(recoveryReceiptPayload(body)) };
}
/** The original receipt is checked independently of today's provider/source. */
export function qualifiedAccountSecurityRecoveryReceipt(value: unknown, uid: string, requestId: string): AccountSecurityRecoveryCommand | null {
  const v = object(value), p = object(v?.restoration);
  if (!v || v.schemaVersion !== 1 || v.action !== 'account_security_recovery' || v.ownerId !== uid || v.actorUid !== uid ||
      !rid(requestId) || v.requestId !== requestId || v.commandId !== accountSecurityRecoveryCommandId(uid, requestId) ||
      typeof v.episodeId !== 'string' || !/^security_[a-f0-9]{64}$/.test(v.episodeId) || !digest(v.sourceHash) ||
      v.inputHash !== accountSecurityRecoveryInputHash(uid, {requestId, expectedEpisodeId:v.episodeId, expectedSourceHash:v.sourceHash}) ||
      v.statementVersion !== ACCOUNT_SECURITY_RECOVERY_VERSION || v.statement !== ACCOUNT_SECURITY_RECOVERY_STATEMENT ||
      v.accepted !== true || !['restored','neutralized'].includes(v.state as string) || !time(v.receivedAt) ||
      !digest(v.receiptHash)) return null;
  if (v.state === 'neutralized' ? v.restoration !== null : !p || !digest(p.episodeHash) || !digest(p.baselineHash) ||
      !Number.isSafeInteger(p.nativeCutoffMs) || (p.nativeCutoffMs as number) < 0 || (p.nativeCutoffMs as number) > v.receivedAt.toMillis() ||
      !digest(p.nativeProviderSetHash) || !provider(p.providerId) || !digest(p.subjectHash) || !seconds(p.authTimeSeconds) ||
      (p.authTimeSeconds as number) * 1000 > v.receivedAt.toMillis() ||
      (p.authTimeSeconds as number) * 1000 < (p.nativeCutoffMs as number) ||
      (own(p,'previousReceiptHash') !== own(p,'previousStateHash')) ||
      own(p,'previousReceiptHash') && (!digest(p.previousReceiptHash) || !digest(p.previousStateHash))) return null;
  return hash(recoveryReceiptPayload(v as unknown as AccountSecurityRecoveryCommand)) === v.receiptHash
    ? v as unknown as AccountSecurityRecoveryCommand : null;
}
export function accountSecurityRecoverySourceHash(episodeId: string, proof: AccountSecurityRecoveryProof) {
  return hash([ACCOUNT_SECURITY_RECOVERY_VERSION, episodeId, proofPayload(proof)]);
}

const RECOVERY_STATE = 'account_security_recovery_state_v1';
export const accountSecurityRecoveryStateId = (uid:string,episodeId:string) => 'recovery_state_' + hash([uid,episodeId]);
const recoveryStatePayload = (v:Record<string,unknown>) => [v.protocol,v.ownerId,v.episodeId,v.revision,v.commandId,
  v.requestId,v.receiptHash,v.sourceHash,clock(v.recordedAt as Timestamp),v.previousReceiptHash,v.previousStateHash];
/** Separate monotone witness: losing only the current profile projection must
 * never turn a previously restored episode back into an initial recovery. */
export function accountSecurityRecoveryState(receipt:AccountSecurityRecoveryCommand,revision:number) {
  const body={protocol:RECOVERY_STATE,ownerId:receipt.ownerId,episodeId:receipt.episodeId,revision,
    commandId:receipt.commandId,requestId:receipt.requestId,receiptHash:receipt.receiptHash,sourceHash:receipt.sourceHash,
    recordedAt:receipt.receivedAt,previousReceiptHash:receipt.restoration?.previousReceiptHash??null,
    previousStateHash:receipt.restoration?.previousStateHash??null};
  return {...body,stateHash:hash(recoveryStatePayload(body))};
}
function recoveryStateMatches(value:unknown,marker:Record<string,unknown>,uid:string,episodeId:string) {
  const s=object(value);
  return !!(s && s.protocol===RECOVERY_STATE && s.ownerId===uid && s.episodeId===episodeId &&
    Number.isSafeInteger(s.revision) && (s.revision as number)>=1 && rid(s.requestId) &&
    s.commandId===accountSecurityRecoveryCommandId(uid,s.requestId) && digest(s.receiptHash) && digest(s.sourceHash) &&
    time(s.recordedAt) && (s.revision===1?s.previousReceiptHash===null && s.previousStateHash===null:
      digest(s.previousReceiptHash) && digest(s.previousStateHash)) &&
    digest(s.stateHash) && hash(recoveryStatePayload(s))===s.stateHash && marker.protocol===ACCOUNT_SECURITY_RECOVERY_VERSION &&
    marker.ownerId===uid && marker.episodeId===episodeId && marker.requestId===s.requestId && marker.commandId===s.commandId &&
    marker.receiptHash===s.receiptHash && marker.sourceHash===s.sourceHash && marker.stateHash===s.stateHash &&
    equalTime(marker.recordedAt,s.recordedAt));
}
export async function readAccountSecurityRecoveryState(profile:FirebaseFirestore.DocumentData|undefined|null,
  tx:FirebaseFirestore.Transaction,uid:string,episode:NonNullable<Awaited<ReturnType<typeof readAccountSecurityEpisode>>>) {
  const id=episode.command.commandId as string,ref=db.collection('eligibility_audit').doc(accountSecurityRecoveryStateId(uid,id));
  const stateSnap=await tx.get(ref),marker=object(profile?.accountSecurityRecovery);
  const unknown={qualification:'unknown' as const,receipt:null,state:null,ref};
  if(!stateSnap.exists) {
    if(!profile || !own(profile,'accountSecurityRecovery')) return {qualification:'initial' as const,receipt:null,state:null,ref};
    // A subsequent containment intentionally retains the prior episode's
    // historical projection. It qualifies neither this new episode nor NEW.
    if(!marker || typeof marker.episodeId!=='string' || !/^security_[a-f0-9]{64}$/.test(marker.episodeId) ||
        marker.episodeId===id || !time(marker.recordedAt) || !before(marker.recordedAt,episode.command.receivedAt)) return unknown;
    const oldState=(await tx.get(db.collection('eligibility_audit').doc(accountSecurityRecoveryStateId(uid,marker.episodeId)))).data();
    if(!recoveryStateMatches(oldState,marker,uid,marker.episodeId)) return unknown;
    const old=qualifiedAccountSecurityRecoveryReceipt((await tx.get(db.collection('eligibility_audit').doc(marker.commandId as string))).data(),uid,marker.requestId as string);
    return old?.state==='restored' && old.receiptHash===marker.receiptHash && old.episodeId===marker.episodeId && old.sourceHash===marker.sourceHash
      ? {qualification:'initial' as const,receipt:null,state:null,ref} : unknown;
  }
  const state=stateSnap.data();
  if(!marker || !recoveryStateMatches(state,marker,uid,id)) return unknown;
  const receipt=qualifiedAccountSecurityRecoveryReceipt((await tx.get(db.collection('eligibility_audit').doc(marker.commandId as string))).data(),uid,marker.requestId as string);
  if(!episode.baselineKnown || !episode.revocationKnown || !receipt || receipt.state!=='restored' || !receipt.restoration ||
      receipt.episodeId!==id || receipt.receiptHash!==marker.receiptHash || receipt.sourceHash!==marker.sourceHash ||
      !equalTime(receipt.receivedAt,marker.recordedAt) || receipt.restoration.episodeHash!==episode.episodeHash ||
      receipt.restoration.baselineHash!==episode.command.identityBaseline.sourceHash ||
      receipt.restoration.authTimeSeconds<=episode.barrier.recordedAt.seconds ||
      (receipt.restoration.previousReceiptHash??null)!==state!.previousReceiptHash ||
      (receipt.restoration.previousStateHash??null)!==state!.previousStateHash ||
      accountSecurityRecoverySourceHash(id,receipt.restoration)!==receipt.sourceHash) return unknown;
  return {qualification:'known' as const,receipt,state:state!,ref};
}

/** Read-only binding of the current V1 episode. Its original command is never
 * rewritten when recovery succeeds; media progress is deliberately not a key. */
export async function readAccountSecurityEpisode(profile: FirebaseFirestore.DocumentData | null | undefined,
  tx: FirebaseFirestore.Transaction, expectedUid: string) {
  const b = object(profile?.accountSecurityBarrier);
  if (!b || b.schemaVersion !== 1 || b.ownerId !== expectedUid || b.source !== 'owner_security_request' || b.accepted !== true ||
      b.statementVersion !== CONTAINMENT_VERSION || b.newEffectsBlocked !== true || !time(b.recordedAt) || !rid(b.requestId) ||
      b.commandId !== 'security_' + hash([expectedUid,b.requestId]) ||
      b.inputHash !== hash([expectedUid,b.requestId,CONTAINMENT_VERSION,true])) return null;
  const c = (await tx.get(db.collection('eligibility_audit').doc(b.commandId as string))).data();
  if (!c || c.schemaVersion !== 1 || c.action !== 'account_security_containment' || c.ownerId !== expectedUid || c.actorUid !== expectedUid ||
      c.commandId !== b.commandId || c.requestId !== b.requestId || c.inputHash !== b.inputHash ||
      c.statementVersion !== CONTAINMENT_VERSION || c.statement !== CONTAINMENT_STATEMENT || c.accepted !== true ||
      !equalTime(c.receivedAt,b.recordedAt) || c.receivedAtMs !== (b.recordedAt as Timestamp).toMillis() ||
      !['revocation_pending','revocation_unknown','contained'].includes(c.state)) return null;
  const binding = { uid: expectedUid, commandId: c.commandId, inputHash:c.inputHash, receivedAt:c.receivedAt };
  const baselineKnown = accountSecurityIdentityBaselineQualification(c, binding) === 'known_subset';
  const revocationKnown = c.state === 'contained' && time(c.authRevocationObservedAt) &&
    Number.isSafeInteger(c.authTokensValidAfterMs) && c.authTokensValidAfterMs >= 0 &&
    c.authTokensValidAfterMs <= Date.now() && Number.isSafeInteger(c.authAttemptStartedAtMs) &&
    c.authTokensValidAfterMs >= Math.floor(c.authAttemptStartedAtMs / 1000) * 1000 &&
    (Number.isSafeInteger(c.authSourceTokensValidAfterMs) && c.authTokensValidAfterMs > c.authSourceTokensValidAfterMs ||
      c.authSourceTokensValidAfterMs === null && time(c.authCallReturnedSuccessfullyAt));
  const episodeHash = hash([CONTAINMENT_VERSION, expectedUid, c.commandId,c.inputHash,clock(c.receivedAt),
    c.state, c.authTokensValidAfterMs ?? null, baselineKnown ? c.identityBaseline.sourceHash : null]);
  return { barrier:b as Record<string,unknown> & {recordedAt:Timestamp}, command:c, binding, baselineKnown, revocationKnown, episodeHash };
}

function nativeIdentities(record: unknown, uid: string) {
  const n = object(record);
  if (!n || n.uid !== uid || n.disabled !== false || !Array.isArray(n.providerData) || n.providerData.length > 16) return null;
  const cutoffMs = typeof n.tokensValidAfterTime === 'string' ? Date.parse(n.tokensValidAfterTime) : NaN;
  if (!Number.isSafeInteger(cutoffMs) || cutoffMs < 0 || cutoffMs > Date.now()) return null;
  const identities: Fingerprint[] = [], seen = new Set<string>();
  for (const raw of n.providerData) {
    const p = object(raw);
    if (!p || !subject(p.providerId) || !subject(p.uid) || seen.has(p.providerId)) return null;
    seen.add(p.providerId);
    if (!provider(p.providerId)) continue;
    if (p.providerId === 'password' && (!subject(n.email) || typeof n.emailVerified !== 'boolean' || p.uid !== n.email ||
        own(p,'email') && p.email !== n.email)) return null;
    identities.push(fingerprint(uid,p.providerId,p.uid));
  }
  sorted(identities);
  return {cutoffMs, identities, providerSetHash:hash(identityPayload(identities))};
}
/** A signed primary authentication is intersected with the immutable initial
 * baseline AND today's native identities. OAuth email never qualifies password. */
export function qualifyAccountSecurityRecoveryAuthentication(episode: NonNullable<Awaited<ReturnType<typeof readAccountSecurityEpisode>>>,
  token: unknown, record: unknown, uid: string, nowMs = Date.now(), requireRecent = true): AccountSecurityRecoveryProof | null {
  if (!episode.baselineKnown || !episode.revocationKnown) return null;
  const t = object(token), fb = object(t?.firebase), ids = object(fb?.identities), n = nativeIdentities(record,uid);
  if (!t || t.sub !== uid || own(t,'uid') && t.uid !== uid || !fb || !ids || !provider(fb.sign_in_provider) || !n ||
      !seconds(t.auth_time) || !seconds(t.iat) || t.auth_time > t.iat || t.iat * 1000 > nowMs ||
      t.auth_time * 1000 > nowMs || requireRecent && nowMs - t.auth_time * 1000 > 5*60_000 ||
      t.auth_time <= (episode.barrier.recordedAt as Timestamp).seconds || t.auth_time * 1000 < n.cutoffMs ||
      n.cutoffMs < episode.command.authTokensValidAfterMs) return null;
  const primary = fb.sign_in_provider, values = primary === 'password' ? ids.email : ids[primary];
  if (!Array.isArray(values) || values.length !== 1 || !subject(values[0]) ||
      primary === 'password' && (!subject(t.email) || t.email !== values[0] || typeof t.email_verified !== 'boolean')) return null;
  const selected = fingerprint(uid,primary,values[0]);
  if (!episode.command.identityBaseline.identities.some((v: Fingerprint) => v.providerId === selected.providerId && v.subjectHash === selected.subjectHash) ||
      !n.identities.some(v => v.providerId === selected.providerId && v.subjectHash === selected.subjectHash)) return null;
  return {episodeHash:episode.episodeHash,baselineHash:episode.command.identityBaseline.sourceHash,nativeCutoffMs:n.cutoffMs,
    nativeProviderSetHash:n.providerSetHash,providerId:primary,subjectHash:selected.subjectHash,authTimeSeconds:t.auth_time};
}

/** No UID/global/session cache. All reads join this exact transaction. A copied
 * marker, old receipt, changed Auth cutoff/provider, or unknown source stays shut. */
export async function qualifyAccountSecurityProfile(profile: FirebaseFirestore.DocumentData | null | undefined,
  tx: FirebaseFirestore.Transaction, expectedUid: string) {
  // Bind the supplied projection to the actual profile document, not only an
  // ownerId declared inside a potentially copied security marker.
  const nativeProfile = (await tx.get(db.collection('eligibility_profiles').doc(expectedUid))).data();
  if (!nativeProfile || !own(nativeProfile,'accountSecurityBarrier')) return profile &&
    (own(profile,'accountSecurityBarrier') || own(profile,'accountSecurityRecovery')) ? {...profile} : nativeProfile;
  const closedProfile = nativeProfile;
  const episode = await readAccountSecurityEpisode(nativeProfile,tx,expectedUid), marker = object(nativeProfile?.accountSecurityRecovery);
  if (!episode || !episode.baselineKnown || !episode.revocationKnown || !marker ||
      !equalTime(profile?.accountSecurityBarrier?.recordedAt,nativeProfile!.accountSecurityBarrier?.recordedAt) ||
      profile?.accountSecurityBarrier?.commandId !== episode.command.commandId ||
      profile?.accountSecurityRecovery?.receiptHash !== marker.receiptHash) return closedProfile;
  const state=await readAccountSecurityRecoveryState(nativeProfile,tx,expectedUid,episode),receipt=state.receipt;
  if(state.qualification!=='known' || !receipt?.restoration) return closedProfile;
  let native;
  try {native = nativeIdentities(await auth.getUser(expectedUid),expectedUid);} catch {return closedProfile;}
  if (!native || native.cutoffMs !== receipt.restoration.nativeCutoffMs || native.providerSetHash !== receipt.restoration.nativeProviderSetHash ||
      !native.identities.some(v=>v.providerId===receipt.restoration!.providerId && v.subjectHash===receipt.restoration!.subjectHash) ||
      !episode.command.identityBaseline.identities.some((v:Fingerprint)=>v.providerId===receipt.restoration!.providerId && v.subjectHash===receipt.restoration!.subjectHash)) return closedProfile;
  return accountSecurityQualifiedProjection(nativeProfile);
}
