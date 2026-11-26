/** Owner-requested containment, independent of commercial suspension/deletion.
 * The private Firestore barrier commits before any Auth call. Unknown Auth
 * outcomes never reopen commerce, move money or create an identity. */
import { createHash, randomUUID } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { auth, db, FieldValue } from '../config/firebase';
import { hasAccountSecurityBarrier } from '../shared/accountSecurity';
import {initialAccountSecurityMedia,accountSecurityMediaView,advanceAccountSecurityMedia} from '../utils/accountSecurityMedia';
import { captureAccountSecurityIdentityOrigin, claimAccountSecurityIdentityObservation,
  accountSecurityIdentityClaimMatches, qualifyAccountSecurityIdentityBaseline,
  unknownAccountSecurityIdentityBaseline, AccountSecurityIdentityBinding } from '../utils/accountSecurityIdentity';
import { ACCOUNT_SECURITY_RECOVERY_VERSION, ACCOUNT_SECURITY_RECOVERY_STATEMENT, accountSecurityRecoveryCommandId,
  accountSecurityRecoveryInputHash, accountSecurityRecoveryReceipt, qualifiedAccountSecurityRecoveryReceipt,
  readAccountSecurityEpisode, qualifyAccountSecurityRecoveryAuthentication, accountSecurityRecoverySourceHash,
  qualifyAccountSecurityProfile, AccountSecurityRecoveryCommand, readAccountSecurityRecoveryState,
  accountSecurityRecoveryState } from '../utils/accountSecurityIdentity';
import { assertPrivateAccountSession } from '../utils/privateAccountSession';

const STATEMENT_VERSION = 'account_security_containment_v1';
const STATEMENT = 'Je demande de bloquer les nouvelles opérations de ce compte et de révoquer ses sessions. Le rétablissement nécessitera un examen par l’équipe.';
const profileRef = (uid: string) => db.collection('eligibility_profiles').doc(uid);
const commandRef = (uid: string, requestId: string) => db.collection('eligibility_audit')
  .doc('security_' + createHash('sha256').update(JSON.stringify([uid, requestId])).digest('hex'));
type State = 'neutralized' | 'revocation_pending' | 'revocation_unknown' | 'contained';
interface Input { expectedUid: string; requestId: string; mode: 'execute' | 'observe' | 'neutralize';
  statementVersion: typeof STATEMENT_VERSION; accepted: true }
const invalid = () => new HttpsError('invalid-argument', 'Demande de sécurisation invalide.');
const conflict = () => new HttpsError('failed-precondition', 'La demande de sécurisation doit être rapprochée. Contactez notre équipe.',
  { reason: 'account_security_reconciliation_required', action: 'contactSupport' });
function input(uid: string, raw: unknown): Input {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw invalid();
  const data = raw as Record<string, unknown>;
  if (Object.keys(data).some(k => !['expectedUid', 'requestId', 'mode', 'statementVersion', 'accepted'].includes(k)) ||
      typeof data.requestId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(data.requestId) ||
      !['execute', 'observe', 'neutralize'].includes(data.mode as string) ||
      data.statementVersion !== STATEMENT_VERSION || data.accepted !== true) throw invalid();
  if (data.expectedUid !== uid) throw new HttpsError('failed-precondition', 'La session a changé. Reprenez depuis votre compte.',
    { reason: 'account_actor_changed', action: 'refreshSession' });
  return data as unknown as Input;
}
function tupleHash(uid: string, data: Input): string {
  return createHash('sha256').update(JSON.stringify([uid, data.requestId, data.statementVersion, data.accepted])).digest('hex');
}
function validCommand(value: FirebaseFirestore.DocumentData | undefined, uid: string, data: Input, id: string) {
  if (!value || value.schemaVersion !== 1 || value.action !== 'account_security_containment' || value.ownerId !== uid ||
      value.actorUid !== uid || value.commandId !== id || value.requestId !== data.requestId || value.inputHash !== tupleHash(uid, data) ||
      value.statementVersion !== STATEMENT_VERSION || value.accepted !== true || value.statement !== STATEMENT ||
      !(value.receivedAt instanceof Timestamp) || !Number.isSafeInteger(value.receivedAtMs) ||
      value.receivedAtMs !== value.receivedAt.toMillis() ||
      !['neutralized', 'revocation_pending', 'revocation_unknown', 'contained'].includes(value.state)) throw conflict();
  if (value.state !== 'neutralized' && (!Number.isSafeInteger(value.leaseUntilMs) || value.leaseUntilMs < 0)) throw conflict();
  if ((Object.prototype.hasOwnProperty.call(value, 'authSourceTokensValidAfterMs') &&
      !(value.authSourceTokensValidAfterMs === null || Number.isSafeInteger(value.authSourceTokensValidAfterMs) && value.authSourceTokensValidAfterMs >= 0)) ||
      (Object.prototype.hasOwnProperty.call(value, 'authAttemptStartedAtMs') &&
      (!Number.isSafeInteger(value.authAttemptStartedAtMs) || !(value.authCallAuthorizedAt instanceof Timestamp)))) throw conflict();
  if (value.state === 'contained' && (!(value.authRevocationObservedAt instanceof Timestamp) ||
      !Number.isSafeInteger(value.authTokensValidAfterMs) || !Number.isSafeInteger(value.authAttemptStartedAtMs) ||
      value.authTokensValidAfterMs < Math.floor(value.authAttemptStartedAtMs / 1000) * 1000 ||
      !(Number.isSafeInteger(value.authSourceTokensValidAfterMs) && value.authTokensValidAfterMs > value.authSourceTokensValidAfterMs ||
        value.authSourceTokensValidAfterMs === null && value.authCallReturnedSuccessfullyAt instanceof Timestamp))) throw conflict();
  return value;
}
function barrierMatches(profile: FirebaseFirestore.DocumentData | undefined, uid: string, data: Input, id: string) {
  const barrier = profile?.accountSecurityBarrier;
  return barrier?.schemaVersion === 1 && barrier.ownerId === uid && barrier.commandId === id &&
    barrier.requestId === data.requestId && barrier.source === 'owner_security_request' && barrier.accepted === true &&
    barrier.statementVersion === STATEMENT_VERSION && barrier.inputHash === tupleHash(uid, data) &&
    barrier.newEffectsBlocked === true && barrier.recordedAt instanceof Timestamp;
}
function dto(uid: string, data: Input, id: string, command: FirebaseFirestore.DocumentData | undefined,
  profile: FirebaseFirestore.DocumentData | undefined) {
  const blocked = hasAccountSecurityBarrier(profile);
  return { protocol: STATEMENT_VERSION, ownerId: uid, requestId: data.requestId, commandId: id,
    state: command?.state ?? 'unrecorded', newEffectsBlocked: blocked,
    authRevocationObserved: command?.state === 'contained',
    authTokensValidAfter: command?.state === 'contained' ? new Date(command.authTokensValidAfterMs).toISOString() : null,
    receivedAt: command?.receivedAt instanceof Timestamp ? command.receivedAt.toDate().toISOString() : null,
    action: command?.state === 'neutralized' ? blocked ? 'contactSupport' : 'acknowledgeNeutralized'
      : command?.state === 'contained' ? 'reauthenticateAndContactSupport'
        : command ? 'resumeSameRequestOrContactSupport' : blocked ? 'contactSupport' : 'resumeOrNeutralizeSameRequest',
    identityRecoveryGranted: false, newOperationsPermissionGranted: false, mediaProtection: accountSecurityMediaView(command,profile) };
}
function cutoff(record: { uid: string; tokensValidAfterTime?: string }, uid: string): number | null {
  if (record.uid !== uid) throw conflict();
  const ms = typeof record.tokensValidAfterTime === 'string' ? Date.parse(record.tokensValidAfterTime) : NaN;
  return Number.isSafeInteger(ms) && ms >= 0 && ms <= Date.now() + 60_000 ? ms : null;
}

export const secureMyAccount = onCall({ region: 'northamerica-northeast1', memory: '512MiB' }, async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentification requise.');
  if (request.data?.action === 'recovery') return recoverMyAccount(request.auth.uid,request.auth.token,request.data);
  const uid = request.auth.uid, originalToken = request.auth.token, data = input(uid, request.data), ref = commandRef(uid, data.requestId);
  const result = await (async () => {
  const native = await db.runTransaction(async tx => {
    const snap = await tx.get(ref), profile = (await tx.get(profileRef(uid))).data();
    if (snap.exists) {
      const command = validCommand(snap.data(), uid, data, ref.id);
      if (!['neutralized','contained'].includes(command.state) && !barrierMatches(profile, uid, data, ref.id)) throw conflict();
      return { command, profile };
    }
    if (data.mode === 'observe') return { command: undefined, profile };
    const receivedAt = Timestamp.now();
    const base = { schemaVersion: 1, action: 'account_security_containment', ownerId: uid, actorUid: uid,
      commandId: ref.id, requestId: data.requestId, inputHash: tupleHash(uid, data), statementVersion: STATEMENT_VERSION,
      accepted: true, statement: STATEMENT, receivedAt, receivedAtMs: receivedAt.toMillis() };
    if (data.mode === 'neutralize') {
      const command = { ...base, state: 'neutralized', sourceExamined: false, neutralizedAt: receivedAt };
      tx.create(ref, command); return { command, profile };
    }
    if (hasAccountSecurityBarrier(profile)) {
      const episode=await readAccountSecurityEpisode(profile,tx,uid),previous=episode && await readAccountSecurityRecoveryState(profile,tx,uid,episode);
      // A fresh original primary login may report a NEW incident even after a
      // legitimate reset made the previous commercial permission stale. This
      // branch only blocks/revokes; it never asks the member to claim that the
      // account is already secured, and it never opens commerce first.
      await assertPrivateAccountSession(request,tx);
      let current;
      try {current=await auth.getUser(uid);} catch{throw conflict();}
      const primary=episode && previous?.qualification==='known' &&
        qualifyAccountSecurityRecoveryAuthentication(episode,originalToken,current,uid);
      if (!primary || previous?.qualification!=='known' || primary.authTimeSeconds<previous.receipt.restoration!.authTimeSeconds) throw new HttpsError('failed-precondition',
        'Un confinement est déjà enregistré. Reprenez sa demande ou contactez notre équipe.',
        { reason: 'account_security_already_contained', action: 'contactSupport' });
    }
    const command = { ...base, state: 'revocation_pending', leaseUntilMs: 0,
      identityOrigin: captureAccountSecurityIdentityOrigin(originalToken, { uid, commandId: ref.id,
        inputHash: base.inputHash, receivedAt }),
      mediaSecurity: initialAccountSecurityMedia(uid, ref.id, receivedAt) };
    const barrier = { schemaVersion: 1, ownerId: uid, commandId: ref.id, requestId: data.requestId,
      inputHash: base.inputHash, source: 'owner_security_request', accepted: true, statementVersion: STATEMENT_VERSION,
      recordedAt: receivedAt, newEffectsBlocked: true };
    tx.create(ref, command);
    tx.set(profileRef(uid), { accountSecurityBarrier: barrier }, { merge: true });
    return { command, profile: { ...profile, accountSecurityBarrier: barrier } };
  });
  if (data.mode !== 'execute' || !native.command || ['neutralized', 'contained'].includes(native.command.state)) {
    return dto(uid, data, ref.id, native.command, native.profile);
  }
  const attemptId = randomUUID();
  const claimed = await db.runTransaction(async tx => {
    const command = validCommand((await tx.get(ref)).data(), uid, data, ref.id);
    const profile = (await tx.get(profileRef(uid))).data();
    if (!barrierMatches(profile, uid, data, ref.id)) throw conflict();
    if (command.state === 'contained' || command.leaseUntilMs > Date.now()) return { claimed: false, command, profile };
    const identityFields: Record<string, unknown> = {};
    if (!Object.prototype.hasOwnProperty.call(command, 'identityBaseline')) {
      const binding: AccountSecurityIdentityBinding = { uid, commandId: ref.id,
        inputHash: command.inputHash, receivedAt: command.receivedAt };
      const at = Timestamp.now();
      if (Object.prototype.hasOwnProperty.call(command, 'identityObservationClaim')) {
        // An earlier attempt owns the first observation. Its missing response
        // cannot be replaced by identities observed during this retry.
        identityFields.identityBaseline = unknownAccountSecurityIdentityBaseline(binding, command.identityOrigin,
          command.identityObservationClaim, 'first_auth_observation_unrecorded', at);
      } else {
        const claim = claimAccountSecurityIdentityObservation(command.identityOrigin, binding, attemptId, at);
        if (claim) identityFields.identityObservationClaim = claim;
        else identityFields.identityBaseline = unknownAccountSecurityIdentityBaseline(binding, command.identityOrigin,
          null, 'original_identity_source_missing_or_invalid', at);
      }
    }
    tx.update(ref, { ...identityFields, attemptId, leaseUntilMs: Date.now() + 120_000, updatedAt: FieldValue.serverTimestamp() });
    return { claimed: true, command: { ...command, ...identityFields }, profile };
  });
  if (!claimed.claimed) return dto(uid, data, ref.id, claimed.command, claimed.profile);
  const finish = async (state: State, fields: Record<string, unknown> = {}) => db.runTransaction(async tx => {
    const command = validCommand((await tx.get(ref)).data(), uid, data, ref.id);
    const profile = (await tx.get(profileRef(uid))).data();
    if (!barrierMatches(profile, uid, data, ref.id)) throw conflict();
    if (command.state === 'contained' || command.attemptId !== attemptId) return dto(uid, data, ref.id, command, profile);
    const next = { ...command, ...fields, state };
    tx.update(ref, { ...fields, state, leaseUntilMs: 0, updatedAt: FieldValue.serverTimestamp() });
    return dto(uid, data, ref.id, next, profile);
  });
  const binding: AccountSecurityIdentityBinding = { uid, commandId: ref.id,
    inputHash: claimed.command.inputHash, receivedAt: claimed.command.receivedAt };
  const recordIdentityObservation = async (record: unknown, observedAt: Timestamp, failed = false) => {
    if (!accountSecurityIdentityClaimMatches(claimed.command.identityObservationClaim,
      claimed.command.identityOrigin, binding, attemptId)) return;
    // Materialize fingerprints synchronously from this response, before the
    // Firestore await; this does not claim Auth/Firestore atomicity.
    const baseline = failed ? unknownAccountSecurityIdentityBaseline(binding, claimed.command.identityOrigin,
      claimed.command.identityObservationClaim, 'first_auth_observation_failed', observedAt)
      : qualifyAccountSecurityIdentityBaseline(binding, claimed.command.identityOrigin,
        claimed.command.identityObservationClaim, attemptId, record, observedAt);
    try {
      await db.runTransaction(async tx => {
        const command = validCommand((await tx.get(ref)).data(), uid, data, ref.id);
        const profile = (await tx.get(profileRef(uid))).data();
        if (!barrierMatches(profile, uid, data, ref.id) ||
            !profile!.accountSecurityBarrier.recordedAt.isEqual(binding.receivedAt) || command.attemptId !== attemptId ||
            Object.prototype.hasOwnProperty.call(command, 'identityBaseline') ||
            command.identityOrigin?.sourceHash !== claimed.command.identityOrigin?.sourceHash ||
            command.identityObservationClaim?.claimHash !== claimed.command.identityObservationClaim?.claimHash ||
            !accountSecurityIdentityClaimMatches(command.identityObservationClaim, command.identityOrigin, binding, attemptId)) return;
        tx.update(ref, { identityBaseline: baseline });
      });
    } catch {
      // Preparation evidence must never prevent the independent revocation.
      logger.warn('Account security identity baseline remains unknown', { ownerId: uid, commandId: ref.id });
    }
  };
  try {
    const beforeRecord = await auth.getUser(uid).catch(async error => {
      await recordIdentityObservation(null, Timestamp.now(), true); throw error;
    });
    const observedAt = Timestamp.now();
    const before = cutoff(beforeRecord, uid);
    await recordIdentityObservation(beforeRecord, observedAt);
    // Recovery accepts only a POSITIVE newer Auth cutoff. Missing/unchanged
    // evidence is not proof that a timed-out revocation had no effect.
    const prior = claimed.command;
    if (Number.isSafeInteger(prior.authSourceTokensValidAfterMs) && Number.isSafeInteger(prior.authAttemptStartedAtMs) &&
        before !== null && before > prior.authSourceTokensValidAfterMs && before >= Math.floor(prior.authAttemptStartedAtMs / 1000) * 1000) {
      return finish('contained', { authTokensValidAfterMs: before, authRevocationObservedAt: Timestamp.now() });
    }
    const authAttemptStartedAtMs = Date.now();
    const authorized = await db.runTransaction(async tx => {
      const command = validCommand((await tx.get(ref)).data(), uid, data, ref.id);
      const profile = (await tx.get(profileRef(uid))).data();
      if (!barrierMatches(profile, uid, data, ref.id)) throw conflict();
      if (command.state === 'contained' || command.attemptId !== attemptId) return false;
      tx.update(ref, { state: 'revocation_pending', authSourceTokensValidAfterMs: before, authAttemptStartedAtMs,
        authCallAuthorizedAt: FieldValue.serverTimestamp() });
      return true;
    });
    if (!authorized) return db.runTransaction(async tx => {
      const command = validCommand((await tx.get(ref)).data(), uid, data, ref.id);
      return dto(uid, data, ref.id, command, (await tx.get(profileRef(uid))).data());
    });
    await auth.revokeRefreshTokens(uid);
    const authCallReturnedSuccessfullyAt = Timestamp.now();
    const after = cutoff(await auth.getUser(uid), uid);
    if (after === null || before !== null && after <= before || after < Math.floor(authAttemptStartedAtMs / 1000) * 1000) return finish('revocation_unknown');
    return finish('contained', { authTokensValidAfterMs: after, authCallReturnedSuccessfullyAt, authRevocationObservedAt: Timestamp.now() });
  } catch {
    logger.warn('Account security Auth outcome unknown', { ownerId: uid, commandId: ref.id });
    return finish('revocation_unknown');
  }
  })();
  // The durable media queue already committed WITH the barrier before Auth.
  // This bounded phase also resumes accepted legacy/contained commands. A
  // media error never changes the independent Auth result or opens the account.
  if (data.mode === 'execute' && result.state !== 'neutralized') {
    // An old terminal receipt is historical after a subsequent episode. Its
    // replay must not restart any Auth/media work for that superseded source.
    if (!barrierMatches((await profileRef(uid).get()).data(),uid,data,ref.id)) return result;
    try { await advanceAccountSecurityMedia(ref.id); }
    catch { logger.warn('Account security media remains unknown', { ownerId: uid, commandId: ref.id }); }
    return db.runTransaction(async tx => {
      const command = validCommand((await tx.get(ref)).data(), uid, data, ref.id);
      return dto(uid, data, ref.id, command, (await tx.get(profileRef(uid))).data());
    });
  }
  return result;
});

type RecoveryInput = {action:'recovery';mode:'execute'|'observe'|'neutralize';expectedUid:string;requestId:string;
  expectedEpisodeId:string;expectedSourceHash:string;statementVersion:typeof ACCOUNT_SECURITY_RECOVERY_VERSION;accepted:true};
const recoveryConflict = () => new HttpsError('failed-precondition',
  'La source de sécurisation a changé ou ne peut pas être vérifiée. Relisez votre demande avant de poursuivre.',
  {reason:'account_security_recovery_source_unqualified',action:'refreshSession'});
function recoveryInput(uid:string,raw:Record<string,unknown>): RecoveryInput {
  if (Object.keys(raw).some(k=>!['action','mode','expectedUid','requestId','expectedEpisodeId','expectedSourceHash','statementVersion','accepted'].includes(k)) ||
      raw.action!=='recovery' || !['execute','observe','neutralize'].includes(raw.mode as string) ||
      typeof raw.requestId!=='string' || !/^[A-Za-z0-9_-]{1,128}$/.test(raw.requestId) ||
      typeof raw.expectedEpisodeId!=='string' || !/^security_[a-f0-9]{64}$/.test(raw.expectedEpisodeId) ||
      typeof raw.expectedSourceHash!=='string' || !/^[a-f0-9]{64}$/.test(raw.expectedSourceHash) ||
      raw.statementVersion!==ACCOUNT_SECURITY_RECOVERY_VERSION || raw.accepted!==true) throw invalid();
  if(raw.expectedUid!==uid) throw recoveryConflict();
  return raw as unknown as RecoveryInput;
}
function recoveryDto(uid:string,d:RecoveryInput,c:AccountSecurityRecoveryCommand|null) {
  return {protocol:ACCOUNT_SECURITY_RECOVERY_VERSION,kind:'receipt',ownerId:uid,requestId:d.requestId,
    commandId:accountSecurityRecoveryCommandId(uid,d.requestId),episodeId:d.expectedEpisodeId,sourceHash:d.expectedSourceHash,
    inputHash:accountSecurityRecoveryInputHash(uid,d),statementVersion:ACCOUNT_SECURITY_RECOVERY_VERSION,accepted:true,
    state:c?.state??'unrecorded',receivedAt:c?c.receivedAt.toDate().toISOString():null,receiptHash:c?.receiptHash??null,
    restorationRecorded:c?.state==='restored',newOperationsPermissionGranted:false,identityRecoveryGranted:false,otherRestrictionsLifted:false};
}
async function recoverMyAccount(uid:string,token:Record<string,unknown>,raw:Record<string,unknown>) {
  if(raw.mode==='preview') {
    if(Object.keys(raw).some(k=>!['action','mode','expectedUid'].includes(k)) || raw.expectedUid!==uid) throw invalid();
    return db.runTransaction(async tx=>{
      const profile=(await tx.get(profileRef(uid))).data();
      const base={protocol:ACCOUNT_SECURITY_RECOVERY_VERSION,kind:'preview',ownerId:uid,
        statementVersion:ACCOUNT_SECURITY_RECOVERY_VERSION,statement:ACCOUNT_SECURITY_RECOVERY_STATEMENT,
        identityRecoveryGranted:false,otherRestrictionsLifted:false};
      const result=(reason:string,episodeId:string|null=null,sourceHash:string|null=null,canStartNewContainment=false)=>({...base,episodeId,sourceHash,
        canRestore:reason==='ready',reason,newEffectsBlocked:!['no_episode','already_restored'].includes(reason),
        restorationRecorded:reason==='already_restored',canStartNewContainment});
      if(!profile || !Object.prototype.hasOwnProperty.call(profile,'accountSecurityBarrier')) return result(
        profile && Object.prototype.hasOwnProperty.call(profile,'accountSecurityRecovery') ? 'source_unqualified' : 'no_episode',null,null,
        !profile || !Object.prototype.hasOwnProperty.call(profile,'accountSecurityRecovery'));
      const episode=await readAccountSecurityEpisode(profile,tx,uid);
      if(!episode) return result('source_unqualified');
      const id=episode.command.commandId as string;
      const previous=await readAccountSecurityRecoveryState(profile,tx,uid,episode);
      if(previous.qualification==='unknown') return result('source_unqualified',id);
      if(!hasAccountSecurityBarrier(await qualifyAccountSecurityProfile(profile,tx,uid))) {
        let current;
        try {current=await auth.getUser(uid);} catch{return result('already_restored',id);}
        const primary=qualifyAccountSecurityRecoveryAuthentication(episode,token,current,uid);
        const canStart=!!primary && previous.qualification==='known' &&
          primary.authTimeSeconds>=previous.receipt.restoration!.authTimeSeconds;
        return result('already_restored',id,null,canStart);
      }
      if(!episode.baselineKnown) return result('baseline_unknown',id);
      if(!episode.revocationKnown) return result('revocation_unknown',id);
      const a=token.auth_time;
      if(!Number.isSafeInteger(a) || (a as number)<=episode.barrier.recordedAt.seconds || (a as number)*1000>Date.now() ||
          Date.now()-(a as number)*1000>5*60_000) return result('reauthentication_required',id);
      let native;
      try {native=await auth.getUser(uid);} catch{return result('source_unqualified',id);}
      const proof=qualifyAccountSecurityRecoveryAuthentication(episode,token,native,uid);
      if(!proof) return result('linked_method_required',id);
      if(previous.qualification==='known') {
        proof.previousReceiptHash=previous.receipt.receiptHash;
        proof.previousStateHash=previous.state.stateHash;
      }
      return result('ready',id,accountSecurityRecoverySourceHash(id,proof),previous.qualification==='known' &&
        proof.authTimeSeconds>=previous.receipt.restoration!.authTimeSeconds);
    });
  }
  const d=recoveryInput(uid,raw), ref=db.collection('eligibility_audit').doc(accountSecurityRecoveryCommandId(uid,d.requestId));
  return db.runTransaction(async tx=>{
    const snap=await tx.get(ref);
    // FIRST: exact original owner receipt survives a later episode, provider,
    // cutoff or restriction change. It never confers permission by itself.
    if(snap.exists) {
      const receipt=qualifiedAccountSecurityRecoveryReceipt(snap.data(),uid,d.requestId);
      if(!receipt || receipt.inputHash!==accountSecurityRecoveryInputHash(uid,d)) throw recoveryConflict();
      return recoveryDto(uid,d,receipt);
    }
    if(d.mode==='observe') return recoveryDto(uid,d,null);
    const receivedAt=Timestamp.now();
    const body:Omit<AccountSecurityRecoveryCommand,'state'|'restoration'|'receiptHash'>={schemaVersion:1 as const,action:'account_security_recovery' as const,ownerId:uid,actorUid:uid,
      commandId:ref.id,requestId:d.requestId,inputHash:accountSecurityRecoveryInputHash(uid,d),episodeId:d.expectedEpisodeId,
      sourceHash:d.expectedSourceHash,statementVersion:ACCOUNT_SECURITY_RECOVERY_VERSION,statement:ACCOUNT_SECURITY_RECOVERY_STATEMENT,
      accepted:true as const,receivedAt};
    if(d.mode==='neutralize') {
      const receipt=accountSecurityRecoveryReceipt({...body,state:'neutralized',restoration:null});
      tx.create(ref,receipt);return recoveryDto(uid,d,receipt);
    }
    const profile=(await tx.get(profileRef(uid))).data(), episode=await readAccountSecurityEpisode(profile,tx,uid);
    if(!episode || episode.command.commandId!==d.expectedEpisodeId) throw recoveryConflict();
    const previous=await readAccountSecurityRecoveryState(profile,tx,uid,episode);
    if(previous.qualification==='unknown') throw recoveryConflict();
    let native;
    try {native=await auth.getUser(uid);} catch{throw recoveryConflict();}
    const restoration=qualifyAccountSecurityRecoveryAuthentication(episode,token,native,uid);
    if(restoration && previous.qualification==='known') {
      restoration.previousReceiptHash=previous.receipt.receiptHash;
      restoration.previousStateHash=previous.state.stateHash;
    }
    if(!restoration || accountSecurityRecoverySourceHash(d.expectedEpisodeId,restoration)!==d.expectedSourceHash) throw recoveryConflict();
    const receipt=accountSecurityRecoveryReceipt({...body,state:'restored',restoration});
    const state=accountSecurityRecoveryState(receipt,previous.qualification==='known'?previous.state.revision+1:1);
    // The current proof and its immutable receipt commit atomically, while the
    // original V1 containment, media queue and other restrictions remain intact.
    tx.create(ref,receipt);
    if(previous.qualification==='initial') tx.create(previous.ref,state); else tx.update(previous.ref,state);
    tx.set(profileRef(uid),{accountSecurityRecovery:{protocol:ACCOUNT_SECURITY_RECOVERY_VERSION,ownerId:uid,
      episodeId:d.expectedEpisodeId,requestId:d.requestId,commandId:ref.id,sourceHash:d.expectedSourceHash,
      receiptHash:receipt.receiptHash,stateHash:state.stateHash,recordedAt:receivedAt}},{merge:true});
    return recoveryDto(uid,d,receipt);
  });
}
