import {providerSecretsForDeployment} from '../config/phase1Deployment';
import {assertPrivateAccountSession, withPrivateAccountSession} from '../utils/privateAccountSession';
import {withFinancialRecoveryScope} from '../utils/financialRecoveryInterlock';
import {GLOBAL_FINANCIAL_RECONCILIATION_CAPABILITY, handleGlobalFinancialReconciliation} from '../utils/globalFinancialReconciliation';
import {FINANCIAL_RECOVERY_STATUS_CAPABILITY, readFinancialRecoveryStatus} from '../utils/financialRecoveryStatus';
import {CONNECT_IDENTITY_RECOVERY_CAPABILITY, handleConnectIdentityRecovery} from '../utils/connectRecoveryIdentity';
import {SELLER_ACTIVITY_REVIEW_CAPABILITY, handleSellerActivityReview} from '../utils/sellerActivityReview';
import {SELLER_TAX_REPORTING_CAPABILITY, handleSellerTaxReporting} from '../utils/sellerTaxDossier';
import {ACCOUNT_CONTROL_PROOF_CAPABILITY, handleAccountControlProof} from '../utils/accountControlProof';
import {SUPPORT_LEGAL_REVIEW_CAPABILITY} from '../utils/supportLegalReviewV2';
import {SUPPORT_PRIVACY_OPERATIONS_CAPABILITY, handleSupportPrivacyOperations} from '../utils/privacyOperations';
import {BUSINESS_CESSATION_CAPABILITY, handleBusinessCessation} from '../utils/businessCessation';
/** Same-UID servicing stays available without profile, active commerce or renewed consent. */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import {Timestamp} from 'firebase-admin/firestore';
import { db, FieldValue } from '../config/firebase';
import {supportActivityProgram, qualifyActivityAssessment} from '../utils/supportActivityCompliance';
import {getStripe} from '../config/stripe';
import {assertOwnedCanadianConnect, ownerPayoutRestriction} from '../utils/stripeBank';
import {assertStoredAccountSecuritySession} from '../utils/storedAccountSecuritySession';
import {privateSupportEvidenceRef, privateSupportJpegSha256, savePrivateSupportCaseJpeg, readPrivateSupportCaseJpeg, type PrivateSupportEvidence} from '../utils/privateSupportCaseEvidence';
import { quebecCivilDate } from '../shared/age';
import { checkRateLimit } from '../utils/rateLimit';
import { SUPPORT_COLLECTION as C, SUPPORT_KINDS, ACCOUNT_SUPPORT_KINDS, ACCOUNT_REVIEW_FINDINGS, MEETUP_SUPPORT_REASONS, SUPPORT_OPTIONS, supportObject, supportText, supportId,
  supportRequestId, supportHash, supportSourceHash, supportUid, supportAccountUid, supportAdmin, supportCurrentAdminClaim, supportCurrentAdminSession, supportVersion, supportOwnerView, supportOwnerSnapshotView, supportAdminView, supportAccountReviewAdminView, supportKindReadable,
  supportDueDate, supportDeclaredDate, qualifySupportEvidence, decisionView, declaredSupportAccounts, declaredSupportRepresentation,
  readSupportAccountSources, supportLateTransportReference, readSupportSwapHoldSource, supportRevision, readSupportWithdrawalTimingSource, readNativeSwapFundReleaseLog,
  supportReturnToSenderReference, SUPPORT_DEADLINE_QUEUE_OPERATION, supportDeadlineCursor, readSupportDeadlinePage } from '../utils/supportRequest';
import { readLateTransportSupportSource } from '../utils/lateTransportIncident';
import { prepareOperationalNotices } from '../utils/notifications';
import { readReturnToSenderSupportSource } from '../utils/returnToSenderCase';
import {PRIVACY_RETENTION_CAPABILITY, isPrivacyRequest, preparePrivacyRetention, privacyRetentionView} from '../utils/privacyRetention';
import {assertRecentAccountAuthentication, assertAccountSecurityOpen} from '../utils/eligibility';
import {LATE_COMMERCIAL_CAPABILITY, LATE_COMMERCIAL_ENABLED, parseLateCommercialLink, prepareLateCommercialSupportLink, lateCommercialSupportView} from '../utils/lateCommercialRecourse';

import {LATE_TRANSPORT_RECOVERY_CAPABILITY, handleLateTransportRecovery} from '../utils/lateTransportRecovery';
import {ACCOUNT_RELATIONSHIP_CAPABILITY, handleAccountRelationshipReview} from '../utils/accountRelationshipReview';
import {SUPPORT_CONFIDENTIALITY_CAPABILITY, handleSupportConfidentiality, handleSupportOriginalV2, projectSupportConfidential,
  readSupportConfidentialCommandGuard, confidentialSupportRecord, materializeSupportConfidentialGuard, supportConfidentialityProjection,
  supportAdminCopySources} from '../utils/supportConfidentiality';
import {AUTHORITY_REQUEST_CAPABILITY, handleAuthorityRequestCommand, handleAuthorityRequestV2, readAuthorityRequests,
  assertNotAuthorityRequest, isAuthorityRequest} from '../utils/authorityRequest';

const OWNER_KEYS = ['action', 'supportRequestId', 'expectedVersion', 'kind', 'narrative', 'discoveredAt', 'interruptionAt',
  'priorSupportRequestId', 'transactionId', 'decision', 'evidence', 'meetupReason', 'relatedAccountIds', 'representation', 'lateTransport', 'swapId', 'withdrawalRequestId', 'returnToSender', 'privacyScope', 'lateCommercial'] as const;
const ADMIN_KEYS = ['action', 'supportRequestId', 'expectedVersion', 'assignedAdminId', 'ownerMessage', 'internalNote', 'response', 'accountReview', 'transportInstruction'] as const;
const protocol = 'support_command_v1';
const OWNER_ACTIONS = ['submit', 'clarify', 'withdraw', 'link_evidence'] as const;
const ADMIN_ACTIONS = ['assign', 'request_details', 'respond', 'internal_note', 'record_account_review', 'record_transport_instruction'] as const;
const transportCommand = (command: any) => command?.lateTransport != null || command?.returnToSender != null || command?.action === 'record_transport_instruction';
const returnToSenderCommand = (command: any) => command?.returnToSender != null ||
  command?.action === 'record_transport_instruction' && command.transportInstruction?.source?.kind === 'return_to_sender_report';
const swapHoldCommand = (command: any) => command.action === 'submit' && command.kind === 'swap_hold_assistance';
const withdrawalTimingCommand = (command: any) => command.action === 'submit' && command.kind === 'withdrawal_timing_assistance';
function parseEnvelope(request: any, admin = false) {
  const uid = supportUid(request), data = supportObject(request.data, ['expectedUid', 'requestId', 'mode', 'command', 'privacyRetentionCapability', 'lateCommercialCapability', 'capability']);
  if (data.capability !== undefined && data.capability !== ACCOUNT_REVIEW_V2) throw new HttpsError('invalid-argument', 'Version de décision de comptes invalide.');
  if (data.lateCommercialCapability !== undefined && data.lateCommercialCapability !== LATE_COMMERCIAL_CAPABILITY)
    throw new HttpsError('invalid-argument', 'Version du recours commercial tardif invalide.');
  if (data.privacyRetentionCapability !== undefined && data.privacyRetentionCapability !== PRIVACY_RETENTION_CAPABILITY)
    throw new HttpsError('invalid-argument', 'Version de conservation privée invalide.');
  const requestId = supportRequestId(data.requestId), command = supportObject(data.command, admin ? ADMIN_KEYS : OWNER_KEYS);
  if (command.lateCommercial !== undefined && (data.lateCommercialCapability !== LATE_COMMERCIAL_CAPABILITY || !['submit','clarify'].includes(command.action)))
    throw new HttpsError('invalid-argument', 'Le lien tardif doit être déclaré au dépôt ou dans une clarification explicite.');
  if (command.lateCommercial !== undefined) parseLateCommercialLink(command.lateCommercial);
  if (!['execute', 'observe'].includes(data.mode) && !(data.mode === 'neutralize' && (data.lateCommercialCapability === LATE_COMMERCIAL_CAPABILITY || data.privacyRetentionCapability === PRIVACY_RETENTION_CAPABILITY || transportCommand(command) || swapHoldCommand(command) || withdrawalTimingCommand(command)))) throw new HttpsError('invalid-argument', 'Mode invalide.');
  const actions: readonly string[] = admin ? ADMIN_ACTIONS : OWNER_ACTIONS;
  if (!actions.includes(command.action)) throw new HttpsError('invalid-argument', 'Action invalide.');
  const id = command.action === 'submit' ? 'support_' + supportHash([uid, requestId]) : supportId(command.supportRequestId);
  if (command.action !== 'submit' && (!Number.isSafeInteger(command.expectedVersion) || command.expectedVersion < 1)) {
    throw new HttpsError('invalid-argument', 'Version attendue requise.');
  }
  if (command.action === 'submit' && (command.supportRequestId != null || command.expectedVersion != null)) throw new HttpsError('invalid-argument', 'Dépôt initial invalide.');
  if (!admin && command.action !== 'submit' && (command.relatedAccountIds != null || command.representation != null || command.lateTransport != null || command.swapId != null || command.withdrawalRequestId != null || command.returnToSender != null)) {
    throw new HttpsError('invalid-argument', 'Pour changer les comptes ou la représentation déclarés, déposez un dossier lié en conservant l’original.');
  }
  if (admin && command.action !== 'record_transport_instruction' && command.transportInstruction != null) {
    throw new HttpsError('invalid-argument', 'Une instruction transport nécessite son action dédiée.');
  }
  return { uid, data, requestId, command, id, hash: supportHash(command) };
}
function commandRef(id: string, uid: string, requestId: string) {
  return db.collection(C).doc(id).collection('commands').doc(supportHash([uid, requestId]));
}
function receiptView(value: any, replay: boolean, currentSource?: any, guard?: any) {
  const projectionSource = currentSource ?? {supportConfidentiality: null};
  const snapshot = supportOwnerSnapshotView(value.ownerSnapshot, transportCommand(value.command), returnToSenderCommand(value.command), projectionSource);
  // The compatibility view strips server-only provenance. Retain the exact
  // native snapshot's provenance until the final guard projection, which strips
  // it again from the DTO. Otherwise a qualified historical B copy can become
  // ambiguous on this second pass after A protected identical older text.
  const guardedSnapshot = snapshot && value.ownerSnapshot?.supportFieldSources
    ? {...snapshot, supportFieldSources: value.ownerSnapshot.supportFieldSources} : snapshot;
  return { protocol, ownerId: value.ownerId, actorId: value.actorId, requestId: value.requestId,
    supportRequestId: value.supportRequestId, action: value.action, payloadHash: value.payloadHash,
    state: value.state, committed: value.state === 'committed', replay, resultVersion: value.resultVersion,
    recordedAt: new Date(value.recordedAtMs).toISOString(), reason: value.reason ?? null,
    request: projectSupportConfidential(guardedSnapshot, projectionSource, guard), admissionVerified: false, financialEffect: 'none', rightsRestored: false };
}
function observeView(uid: string, id: string, requestId: string, command: any, hash: string) {
  return { protocol, actorId: uid, ownerId: null, supportRequestId: id, requestId, action: command.action, payloadHash: hash,
    state: 'unrecorded', committed: false, replay: false, resultVersion: null, recordedAt: null, reason: null, request: null,
    admissionVerified: false, financialEffect: 'none', rightsRestored: false };
}
function assertReplay(receipt: any, uid: string, id: string, requestId: string, hash: string) {
  if (receipt.protocol !== protocol || receipt.actorId !== uid || receipt.supportRequestId !== id || receipt.requestId !== requestId || receipt.payloadHash !== hash) {
    throw new HttpsError('already-exists', 'Cet identifiant correspond à une autre commande.');
  }
  if (!['committed', 'not_executed'].includes(receipt.state) || !Number.isSafeInteger(receipt.recordedAtMs) || receipt.recordedAtMs < 1 ||
      (receipt.state === 'committed' && (!receipt.ownerSnapshot || receipt.ownerSnapshot.ownerId !== receipt.ownerId || receipt.ownerSnapshot.id !== id || receipt.ownerSnapshot.version !== receipt.resultVersion))) {
    throw new HttpsError('failed-precondition', 'Reçu historique non qualifié.');
  }
}
function recordCommand(tx: FirebaseFirestore.Transaction, ref: FirebaseFirestore.DocumentReference, id: string,
  uid: string, requestId: string, command: any, hash: string, record: any, atMs: number, reason: string | null = null) {
  const value = { protocol, ownerId: record.ownerId, actorId: uid, supportRequestId: id, requestId, action: command.action,
    actorRole: (OWNER_ACTIONS as readonly string[]).includes(command.action) ? 'owner' : 'admin',
    payloadHash: hash, state: reason ? 'not_executed' : 'committed', resultVersion: supportVersion(record),
    recordedAtMs: atMs, reason, ownerSnapshot: {...supportOwnerView(id, record, atMs, transportCommand(command), returnToSenderCommand(command)),
      ...(record.supportFieldSources ? {supportFieldSources: record.supportFieldSources} : {})}, command };
  tx.create(ref, value);
  if (record.supportConfidentiality) tx.set(db.collection(C).doc(id), {supportConfidentiality: record.supportConfidentiality}, {merge: true});
  return receiptView(value, false, record);
}

const ACCOUNT_REVIEW_V2 = 'support_account_review_v2';
const ACCOUNT_REVIEW_RECEIPT_V2 = 'support_account_review_receipt_v2';
const accountReceiptOperations = ['account_review_decision_receipt', 'account_review_evidence_receipt'];
const accountEvidenceOperations = ['account_review_evidence_upload', 'account_review_evidence_read', 'account_review_preview'];
const accountV2Effects = {otherAccountAccessGranted: false, paymentAuthorityGranted: false,
  providerRestrictionOverridden: false, accountsMerged: false, fundsMoved: false, physicalIdentityAutomaticallyInferred: false};
async function accountReviewAdmin(tx: FirebaseFirestore.Transaction, request: any) {
  const session = await assertPrivateAccountSession(request, tx);
  await supportAdmin(tx, supportUid(request), session.currentAdminClaim);
  assertRecentAccountAuthentication(request.auth.token);
  await assertAccountSecurityOpen((await tx.get(db.collection('eligibility_profiles').doc(request.auth.uid))).data(), tx, request.auth.uid);
}
function accountReviewCase(record: any) {
  if (!record || !(ACCOUNT_SUPPORT_KINDS as readonly unknown[]).includes(record.kind) || record.schemaVersion !== 1) {
    throw new HttpsError('failed-precondition', 'Un dossier courant de comptes est requis.');
  }
  supportVersion(record); declaredSupportAccounts(record.relatedAccountIds);
  return record;
}
function reviewEvidenceView(record: any) {
  return {evidence: privateSupportEvidenceRef({evidenceId: record.evidenceId, generation: record.generation,
    sha256: record.sha256, sizeBytes: record.sizeBytes}), purpose: record.purpose, uploadedAt: new Date(record.uploadedAtMs).toISOString()};
}
type AccountReceiptDescriptor = {operation: 'account_review_decision_receipt'|'account_review_evidence_receipt';
  actorId: string; supportRequestId: string; requestId: string; payloadHash: string; expectedVersion: number; purpose: string|null};
const evidenceUploadHash = (supportRequestId: string, expectedVersion: number, purpose: string, sha256: string) =>
  supportHash({supportRequestId, expectedVersion, purpose, sha256});
function accountReceiptView(descriptor: AccountReceiptDescriptor, raw: any, replayed = true) {
  const base = {protocol: ACCOUNT_REVIEW_RECEIPT_V2, ...descriptor, storageOutcome: 'not_asserted' as const};
  if (!raw) return {...base, state: 'unrecorded', committed: false, replayed: false, recordedAt: null,
    resultVersion: null, reason: null, evidence: null};
  if (raw.protocol === ACCOUNT_REVIEW_RECEIPT_V2) {
    if (Object.keys(descriptor).some(key => raw[key] !== descriptor[key as keyof AccountReceiptDescriptor])) {
      throw new HttpsError('already-exists', 'Cet identifiant correspond à une autre intention V2.');
    }
    if (raw.schemaVersion !== 1 || !['committed', 'not_executed'].includes(raw.state) ||
        raw.state === 'not_executed' && (raw.reason !== 'command_neutralized' || raw.evidence !== null || raw.resultVersion !== null) ||
        !Number.isSafeInteger(raw.recordedAtMs) || raw.recordedAtMs < 1 || raw.recordedAtMs > Date.now()) {
      throw new HttpsError('failed-precondition', 'Le reçu opaque ne correspond pas à cette intention.');
    }
    const evidence = raw.state === 'committed' && descriptor.operation === 'account_review_evidence_receipt'
      ? privateSupportEvidenceRef(raw.evidence) : null;
    if (raw.state === 'committed' && (!Number.isSafeInteger(raw.resultVersion) || raw.resultVersion < 1 ||
        descriptor.operation !== 'account_review_evidence_receipt' || raw.resultVersion !== descriptor.expectedVersion || raw.reason !== null || !evidence ||
        evidence.evidenceId !== 'spe_' + supportHash([descriptor.supportRequestId, descriptor.actorId, descriptor.requestId]) ||
        evidenceUploadHash(descriptor.supportRequestId, descriptor.expectedVersion, descriptor.purpose!, evidence.sha256) !== descriptor.payloadHash)) {
      throw new HttpsError('failed-precondition', 'Le reçu d’attachement privé doit être qualifié.');
    }
    return {...base, state: raw.state as string, committed: raw.state === 'committed', replayed,
      recordedAt: new Date(raw.recordedAtMs).toISOString(), resultVersion: raw.resultVersion as number|null,
      reason: raw.reason === 'command_neutralized' ? 'command_neutralized' : null, evidence};
  }
  if (descriptor.operation === 'account_review_evidence_receipt') {
    if (raw.protocol !== 'private_support_evidence_v1' || raw.actorUid !== descriptor.actorId || raw.supportRequestId !== descriptor.supportRequestId ||
        raw.requestId !== descriptor.requestId || raw.purpose !== descriptor.purpose || raw.uploadedCaseVersion !== descriptor.expectedVersion ||
        evidenceUploadHash(descriptor.supportRequestId, descriptor.expectedVersion, raw.purpose, raw.sha256) !== descriptor.payloadHash ||
        raw.evidenceId !== 'spe_' + supportHash([descriptor.supportRequestId, descriptor.actorId, descriptor.requestId]) ||
        !Number.isSafeInteger(raw.uploadedAtMs) || raw.uploadedAtMs < 1 || raw.uploadedAtMs > Date.now()) {
      throw new HttpsError('failed-precondition', 'L’attachement privé ne correspond pas à cette intention.');
    }
    return {...base, state: 'committed', committed: true, replayed, recordedAt: new Date(raw.uploadedAtMs).toISOString(),
      resultVersion: descriptor.expectedVersion, reason: null, evidence: reviewEvidenceView(raw).evidence};
  }
  assertReplay(raw, descriptor.actorId, descriptor.supportRequestId, descriptor.requestId, descriptor.payloadHash);
  if (raw.actorRole !== 'admin' || raw.action !== 'record_account_review' || raw.command?.action !== 'record_account_review' ||
      raw.command?.accountReview?.protocol !== ACCOUNT_REVIEW_V2 || raw.command?.supportRequestId !== descriptor.supportRequestId ||
      raw.command?.expectedVersion !== descriptor.expectedVersion || supportHash(raw.command) !== descriptor.payloadHash) {
    throw new HttpsError('failed-precondition', 'Le reçu de décision ne correspond pas à cette intention V2.');
  }
  if (!Number.isSafeInteger(raw.resultVersion) || raw.resultVersion < 1 || raw.recordedAtMs > Date.now()) {
    throw new HttpsError('failed-precondition', 'La chronologie du reçu de décision doit être qualifiée.');
  }
  return {...base, state: raw.state as string, committed: raw.state === 'committed', replayed,
    recordedAt: new Date(raw.recordedAtMs).toISOString(), resultVersion: raw.resultVersion as number,
    reason: raw.reason === 'command_neutralized' ? 'command_neutralized' : null, evidence: null};
}
function accountReceiptTombstone(descriptor: AccountReceiptDescriptor) {
  return {protocol: ACCOUNT_REVIEW_RECEIPT_V2, schemaVersion: 1, ...descriptor, state: 'not_executed',
    recordedAtMs: Date.now(), resultVersion: null, reason: 'command_neutralized', evidence: null};
}
function evidenceReceiptRef(id: string, uid: string, requestId: string) {
  return db.collection(C).doc(id).collection('review_evidence_commands').doc(supportHash([uid, requestId]));
}
async function handleAccountReviewReceipt(request: any) {
  const data = supportObject(request.data, ['capability', 'expectedUid', 'operation', 'mode', 'supportRequestId', 'requestId',
    'payloadHash', 'expectedVersion', 'purpose']);
  const uid = supportUid(request), id = supportId(data.supportRequestId), requestId = supportRequestId(data.requestId);
  const evidence = data.operation === 'account_review_evidence_receipt';
  if (data.capability !== ACCOUNT_REVIEW_V2 || !accountReceiptOperations.includes(data.operation) || !['observe', 'neutralize'].includes(data.mode) ||
      typeof data.payloadHash !== 'string' || !/^[a-f0-9]{64}$/.test(data.payloadHash) || !Number.isSafeInteger(data.expectedVersion) || data.expectedVersion < 1 ||
      (evidence ? !['identity', 'authority', 'relationship', 'provider_restriction', 'activity', 'regulatory_basis', 'other'].includes(data.purpose) : data.purpose !== undefined && data.purpose !== null)) {
    throw new HttpsError('invalid-argument', 'Descripteur opaque de reçu V2 invalide.');
  }
  const descriptor: AccountReceiptDescriptor = {operation: data.operation, actorId: uid, supportRequestId: id, requestId,
    payloadHash: data.payloadHash, expectedVersion: data.expectedVersion, purpose: evidence ? data.purpose : null};
  // This servicing authority is only the actor's current SDK session. It never
  // reads the case body, an evidence object, another account or an admin role.
  return db.runTransaction(async tx => {
    await assertPrivateAccountSession(request, tx);
    const ref = evidence ? evidenceReceiptRef(id, uid, requestId) : commandRef(id, uid, requestId), receipt = (await tx.get(ref)).data();
    const attachment = evidence ? (await tx.get(db.collection(C).doc(id).collection('review_evidence')
      .doc('spe_' + supportHash([id, uid, requestId])))).data() : null;
    if (receipt?.protocol === ACCOUNT_REVIEW_RECEIPT_V2 && receipt.state === 'not_executed' && attachment) {
      throw new HttpsError('failed-precondition', 'Les preuves natives d’attachement doivent être rapprochées.');
    }
    if (receipt) return accountReceiptView(descriptor, receipt);
    if (attachment) return accountReceiptView(descriptor, attachment);
    if (data.mode === 'observe') return accountReceiptView(descriptor, null);
    const tombstone = accountReceiptTombstone(descriptor);
    tx.create(ref, tombstone);
    return accountReceiptView(descriptor, tombstone, false);
  });
}
async function selectedAccountObligations(tx: FirebaseFirestore.Transaction, record: any, raw: unknown, exact = false) {
  if (!Array.isArray(raw) || raw.length > 20) throw new HttpsError('invalid-argument', 'Vingt obligations sélectionnées maximum.');
  const participants = declaredSupportAccounts(record.relatedAccountIds), seen = new Set<string>(), result = [];
  for (const value of raw) {
    const ref = supportObject(value, exact ? ['kind', 'id', 'sourceHash', 'sourceRevision'] : ['kind', 'id']);
    const collection = {transaction: 'transactions', swap: 'swaps', withdrawal: 'withdrawal_requests',wallet:'wallets'}[ref.kind as 'transaction'|'swap'|'withdrawal'|'wallet'];
    if (!collection) throw new HttpsError('invalid-argument', 'Type d’obligation invalide.');
    const id = ref.kind==='wallet'?supportAccountUid(ref.id):supportId(ref.id), key = `${ref.kind}:${id}`;
    if (seen.has(key)) throw new HttpsError('invalid-argument', 'Obligation en double.');
    seen.add(key);
    const snapshot = await tx.get(db.collection(collection).doc(id)), source = snapshot.data(), revision = supportRevision(snapshot);
    const owners = ref.kind === 'transaction' ? [source?.buyerId, source?.sellerId] : ref.kind === 'swap'
      ? [source?.initiatorId, source?.receiverId] : ref.kind==='wallet'?[snapshot.id]:[source?.userId];
    // getOrCreateWallet owns wallets/{uid}; it does not persist userId. Bind
    // the real document ID and refuse an imported contradictory identity.
    if (!source || !revision || !participants.some(uid => owners.includes(uid))||ref.kind==='wallet'&&
      (snapshot.id!==id||Object.prototype.hasOwnProperty.call(source,'userId')&&source.userId!==id||!participants.includes(id))) {
      throw new HttpsError('permission-denied', 'Obligation non liée aux comptes déclarés.');
    }
    const descriptor = {kind: ref.kind as string, id, sourceHash: supportSourceHash({collection, id, source}), sourceRevision: revision};
    if (exact && (ref.sourceHash !== descriptor.sourceHash || ref.sourceRevision !== descriptor.sourceRevision)) {
      throw new HttpsError('aborted', 'Une obligation a changé. Relisez le dossier.');
    }
    result.push(descriptor);
  }
  return result;
}
async function providerAccountReviewObservation(request: any, supportRequestId: string, subjectUid: string) {
  const initial = await db.runTransaction(async tx => {
    await accountReviewAdmin(tx, request);
    const record = accountReviewCase((await tx.get(db.collection(C).doc(supportRequestId))).data());
    if (record.kind !== 'payment_account_review' || !declaredSupportAccounts(record.relatedAccountIds).includes(subjectUid)) {
      throw new HttpsError('invalid-argument', 'Compte de paiement déclaré requis.');
    }
    const owner = await tx.get(db.collection('users').doc(subjectUid)), accountId = owner.data()?.stripeAccountId;
    if (typeof accountId !== 'string' || !/^acct_[A-Za-z0-9_]{1,190}$/.test(accountId)) {
      throw new HttpsError('failed-precondition', 'La liaison native du compte de paiement doit être examinée.');
    }
    return {accountId, userRevision: supportRevision(owner), version: supportVersion(record)};
  });
  const stripe = getStripe();
  if (!stripe) throw new HttpsError('unavailable', 'Observation du compte de paiement indisponible.');
  const account = await stripe.accounts.retrieve(initial.accountId);
  assertOwnedCanadianConnect(account, subjectUid, initial.accountId);
  const providerSourceHash = supportHash({id: account.id, payouts_enabled: account.payouts_enabled,
    requirements: account.requirements, capabilities: account.capabilities, settings: account.settings});
  const ownerRestriction = ownerPayoutRestriction(subjectUid, account);
  return {protocol: 'support_provider_observation_v1', subjectUid, ...initial, providerSourceHash,
    ownerRestriction, observedAtMs: Date.now(), screeningCoverage: 'provider_account_observation_only', ...accountV2Effects};
}
async function handleAccountReviewEvidence(request: any, endpoint: 'owner'|'admin'|'read') {
  const data = supportObject(request.data, ['capability', 'expectedUid', 'operation', 'scope', 'supportRequestId',
    'expectedVersion', 'requestId', 'purpose', 'jpegBase64', 'evidence', 'obligations', 'evidenceCursor', 'subjectUid']);
  const uid = supportUid(request), id = supportId(data.supportRequestId), ref = db.collection(C).doc(id), operation = data.operation;
  if (data.capability !== ACCOUNT_REVIEW_V2 || !accountEvidenceOperations.includes(operation) ||
      (operation === 'account_review_evidence_upload' ? endpoint === 'read' : endpoint !== 'read' || data.scope !== 'admin')) {
    throw new HttpsError('invalid-argument', 'Opération de pièces privées invalide.');
  }
  const admin = endpoint !== 'owner';
  const readCase = async (tx: FirebaseFirestore.Transaction) => {
    if (admin) await accountReviewAdmin(tx, request); else {
      await assertPrivateAccountSession(request, tx);
      assertRecentAccountAuthentication(request.auth.token);
    }
    const current = accountReviewCase((await tx.get(ref)).data());
    if (!admin && current.ownerId !== uid) throw new HttpsError('permission-denied', 'Dossier privé non autorisé.');
    return current;
  };
  if (operation === 'account_review_evidence_upload') {
    const requestId = supportRequestId(data.requestId), purpose = data.purpose;
    const inputSha256 = privateSupportJpegSha256(data.jpegBase64);
    if (!['identity', 'authority', 'relationship', 'provider_restriction', 'activity', 'regulatory_basis', 'other'].includes(purpose) ||
        !Number.isSafeInteger(data.expectedVersion) || data.expectedVersion < 1) throw new HttpsError('invalid-argument', 'Portée et version de la pièce requises.');
    const payloadHash = evidenceUploadHash(id, data.expectedVersion, purpose, inputSha256);
    const descriptor: AccountReceiptDescriptor = {operation: 'account_review_evidence_receipt', actorId: uid, supportRequestId: id,
      requestId, payloadHash, expectedVersion: data.expectedVersion, purpose};
    const evidenceId = 'spe_' + supportHash([id, uid, requestId]), evidenceRef = ref.collection('review_evidence').doc(evidenceId);
    const opRef = evidenceReceiptRef(id, uid, requestId);
    const prior = await db.runTransaction(async tx => {
      await assertPrivateAccountSession(request, tx);
      const receipt = (await tx.get(opRef)).data();
      if (receipt) return {receipt: accountReceiptView(descriptor, receipt), attachment: null};
      const current = await readCase(tx), prior = (await tx.get(evidenceRef)).data();
      if (prior) {
        if (prior.actorUid !== uid || prior.requestId !== requestId || prior.purpose !== purpose || prior.sha256 !== inputSha256 ||
            prior.uploadedCaseVersion !== data.expectedVersion) throw new HttpsError('already-exists', 'Cet identifiant de pièce est déjà utilisé.');
        return {receipt: null, attachment: prior};
      }
      if (supportVersion(current) !== data.expectedVersion || ['withdrawn', 'answered'].includes(current.status)) throw new HttpsError('aborted', 'Relisez le dossier courant avant de joindre une pièce.');
      return null;
    });
    if (prior?.receipt) return prior.receipt;
    if (prior?.attachment) return {protocol: ACCOUNT_REVIEW_V2, supportRequestId: id, payloadHash, replayed: true, ...reviewEvidenceView(prior.attachment)};
    await checkRateLimit(uid, true, {functionName: 'supportAccountReviewEvidenceUpload', maxCallsAuthenticated: admin ? 30 : 10,
      maxCallsUnauthenticated: 0, windowMs: 60_000});
    const native = await savePrivateSupportCaseJpeg(id, uid, requestId, data.jpegBase64);
    return db.runTransaction(async tx => {
      await assertPrivateAccountSession(request, tx);
      const receipt = (await tx.get(opRef)).data();
      // A neutralization racing the GCS POST prevents ATTACHMENT, not the
      // already attempted upload. An orphan remains private and unadopted.
      if (receipt) return accountReceiptView(descriptor, receipt);
      const current = await readCase(tx), prior = (await tx.get(evidenceRef)).data();
      if (prior) {
        if (supportHash(reviewEvidenceView(prior).evidence) !== supportHash(privateSupportEvidenceRef({evidenceId: native.evidenceId,
          generation: native.generation, sha256: native.sha256, sizeBytes: native.sizeBytes})) || prior.purpose !== purpose || prior.uploadedCaseVersion !== data.expectedVersion) {
          throw new HttpsError('already-exists', 'La pièce native diffère de cette demande.');
        }
        return {protocol: ACCOUNT_REVIEW_V2, supportRequestId: id, payloadHash, replayed: true, ...reviewEvidenceView(prior)};
      }
      if (supportVersion(current) !== data.expectedVersion || ['withdrawn', 'answered'].includes(current.status)) throw new HttpsError('aborted', 'Le dossier a changé ; la pièce reste privée et aucune décision n’est prise.');
      const record = {...native, purpose, uploadedCaseVersion: data.expectedVersion, uploadedAtMs: Date.now()};
      tx.create(evidenceRef, record);
      tx.create(opRef, {protocol: ACCOUNT_REVIEW_RECEIPT_V2, schemaVersion: 1, ...descriptor, state: 'committed',
        recordedAtMs: record.uploadedAtMs, resultVersion: data.expectedVersion, reason: null, evidence: reviewEvidenceView(record).evidence});
      return {protocol: ACCOUNT_REVIEW_V2, supportRequestId: id, payloadHash, replayed: false, ...reviewEvidenceView(record)};
    });
  }
  if (operation === 'account_review_evidence_read') {
    await checkRateLimit(uid, true, {functionName: 'supportAccountReviewEvidenceRead', maxCallsAuthenticated: 30,
      maxCallsUnauthenticated: 0, windowMs: 60_000});
    const expected = privateSupportEvidenceRef(data.evidence), requestId = supportRequestId(data.requestId);
    const native = await db.runTransaction(async tx => {
      const current = await readCase(tx), record = (await tx.get(ref.collection('review_evidence').doc(expected.evidenceId))).data();
      if (supportVersion(current) !== data.expectedVersion || !record || supportHash(reviewEvidenceView(record).evidence) !== supportHash(expected)) {
        throw new HttpsError('aborted', 'Pièce ou dossier modifié.');
      }
      return record as PrivateSupportEvidence;
    });
    const bytes = await readPrivateSupportCaseJpeg(native);
    return db.runTransaction(async tx => {
      const current = await readCase(tx), record = (await tx.get(ref.collection('review_evidence').doc(expected.evidenceId))).data();
      if (supportVersion(current) !== data.expectedVersion || !record || supportHash(reviewEvidenceView(record).evidence) !== supportHash(expected)) throw new HttpsError('aborted', 'Pièce ou dossier modifié pendant la lecture.');
      const readId = 'ser_' + supportHash([id, uid, requestId]), readRef = ref.collection('review_evidence_reads').doc(readId), prior = (await tx.get(readRef)).data();
      const journal = {protocol: 'support_evidence_read_v1', actorUid: uid, supportRequestId: id, requestId, evidence: expected,
        authTime: request.auth.token.auth_time, caseVersion: data.expectedVersion, readAtMs: Date.now()};
      if (prior && (prior.actorUid !== uid || prior.authTime !== journal.authTime || supportHash(prior.evidence) !== supportHash(expected))) throw new HttpsError('already-exists', 'Cette lecture appartient à une autre intention ou connexion.');
      if (!prior) tx.create(readRef, journal);
      return {protocol: ACCOUNT_REVIEW_V2, actorId: uid, supportRequestId: id, readId, evidence: expected,
        jpegBase64: bytes.toString('base64'), readAt: new Date(prior?.readAtMs ?? journal.readAtMs).toISOString()};
    });
  }
  await checkRateLimit(uid, true, {functionName: 'supportAccountReviewPreview', maxCallsAuthenticated: 30,
    maxCallsUnauthenticated: 0, windowMs: 60_000});
  const provider = data.subjectUid == null ? null : await providerAccountReviewObservation(request, id, supportAccountUid(data.subjectUid));
  return db.runTransaction(async tx => {
    const current = await readCase(tx), accountSources = await readSupportAccountSources(tx, current);
    const obligations = await selectedAccountObligations(tx, current, data.obligations ?? []);
    if (data.evidenceCursor != null && !/^spe_[a-f0-9]{64}$/.test(data.evidenceCursor)) throw new HttpsError('invalid-argument', 'Curseur de pièces invalide.');
    let query = ref.collection('review_evidence').orderBy('__name__').limit(21);
    if (data.evidenceCursor) query = query.startAfter(data.evidenceCursor);
    const page = await tx.get(query), rows = page.docs.slice(0, 20), last = rows.at(-1);
    let providerObservation: any = null;
    if (provider) {
      const user = await tx.get(db.collection('users').doc(provider.subjectUid));
      if (supportVersion(current) !== provider.version || supportRevision(user) !== provider.userRevision || user.data()?.stripeAccountId !== provider.accountId) {
        throw new HttpsError('aborted', 'La liaison du compte de paiement a changé.');
      }
      const observationId = 'spo_' + supportHash([id, uid, provider, request.auth.token.auth_time]);
      providerObservation = {...provider, observationId, actorUid: uid, authTime: request.auth.token.auth_time};
      tx.create(ref.collection('provider_observations').doc(observationId), providerObservation);
    }
    return {protocol: ACCOUNT_REVIEW_V2, actorId: uid, supportRequestId: id, version: supportVersion(current), accountSources, obligations,
      evidencePage: {items: rows.map(doc => reviewEvidenceView(doc.data())), hasMore: page.size > 20, cursor: page.size > 20 ? last?.id ?? null : null},
      activityProgram: current.kind === 'activity_compliance_review' ? supportActivityProgram() : null, providerObservation, currentReview: supportAccountReviewAdminView(current.accountReview), selectedObligationsOnly: true, ...accountV2Effects};
  });
}
async function prepareAccountReviewV2(tx: FirebaseFirestore.Transaction, request: any, record: any, id: string,
  requestId: string, raw: unknown, provider: Awaited<ReturnType<typeof providerAccountReviewObservation>> | null) {
  await accountReviewAdmin(tx, request);
  accountReviewCase(record);
  const review = supportObject(raw, ['protocol', 'finding', 'subjectUid', 'reason', 'ownerMessage', 'recourse', 'reviewDueAt',
    'expectedSources', 'evidenceReads', 'obligations', 'expectedRestrictionReceiptId', 'providerObservationId',
    'identityDocumentsReviewed', 'authorityDocumentsReviewed', 'accountRelationshipReviewed', 'documentsReadAccepted', 'activityAssessment']);
  const uid = supportUid(request), subjectUid = supportAccountUid(review.subjectUid), findings = ['restrict_new_operations', 'lift_own_restriction',
    'representation_authority_confirmed', 'representation_not_confirmed', 'provider_restriction_maintained', 'provider_documents_requested', 'provider_recourse_recorded', 'activity_restriction_maintained', 'activity_documents_requested', 'activity_no_prohibition_identified'];
  if (review.protocol !== ACCOUNT_REVIEW_V2 || !findings.includes(review.finding) || review.documentsReadAccepted !== true ||
      !declaredSupportAccounts(record.relatedAccountIds).includes(subjectUid)) throw new HttpsError('invalid-argument', 'Décision humaine et compte déclaré requis.');
  const representation = review.finding.startsWith('representation_'), providerFinding = review.finding.startsWith('provider_'),
    activityFinding = record.kind === 'activity_compliance_review';
  if (representation !== (record.kind === 'representation_review') || providerFinding !== (record.kind === 'payment_account_review') ||
      !representation && !providerFinding && !['account_reconciliation', 'restriction_circumvention', 'activity_compliance_review'].includes(record.kind) ||
      review.finding.startsWith('activity_') && !activityFinding) {
    throw new HttpsError('invalid-argument', 'Cette décision ne correspond pas au motif du dossier.');
  }
  const reason = supportText(review.reason, 'Motivation privée'), ownerMessage = supportText(review.ownerMessage, 'Motivation communiquée'),
    recourse = supportText(review.recourse, 'Recours et voie contradictoire'), reviewDueAtMs = Date.parse(review.reviewDueAt);
  if (typeof review.reviewDueAt !== 'string' || !Number.isSafeInteger(reviewDueAtMs) || new Date(reviewDueAtMs).toISOString() !== review.reviewDueAt || reviewDueAtMs <= Date.now() ||
      reviewDueAtMs > Date.now() + 90 * 86400_000) throw new HttpsError('invalid-argument', 'Une révision future dans les 90 jours est requise.');
  const sources = await readSupportAccountSources(tx, record);
  const sourceDescriptors = sources.map(source => ({declaredAccountId: source.declaredAccountId, sourceHash: source.sourceHash,
    userRevision: source.userRevision, eligibilityRevision: source.eligibilityRevision}));
  if (!Array.isArray(review.expectedSources) || review.expectedSources.length !== sources.length ||
      new Set(review.expectedSources.map((s: any) => s?.declaredAccountId)).size !== sources.length ||
      sourceDescriptors.some(source => !review.expectedSources.some((s: any) => supportHash(s) === supportHash(source)))) {
    throw new HttpsError('aborted', 'Les sources de comptes ont changé. Relisez le dossier.');
  }
  if (!Array.isArray(review.evidenceReads) || review.evidenceReads.length < 1 || review.evidenceReads.length > 10) {
    throw new HttpsError('invalid-argument', 'Une à dix pièces réellement lues sont requises.');
  }
  const evidenceReads = [], purposeReads: {readId: string; purpose: string}[] = [], purposes = new Set<string>(), seen = new Set<string>();
  for (const value of review.evidenceReads) {
    const selected = supportObject(value, ['readId', 'evidence']), expected = privateSupportEvidenceRef(selected.evidence);
    if (!/^ser_[a-f0-9]{64}$/.test(selected.readId ?? '') || seen.has(expected.evidenceId)) throw new HttpsError('invalid-argument', 'Lecture exacte et unique requise.');
    seen.add(expected.evidenceId);
    const read = (await tx.get(db.collection(C).doc(id).collection('review_evidence_reads').doc(selected.readId))).data();
    const evidence = (await tx.get(db.collection(C).doc(id).collection('review_evidence').doc(expected.evidenceId))).data();
    if (!read || read.protocol !== 'support_evidence_read_v1' || read.actorUid !== uid || read.supportRequestId !== id ||
        selected.readId !== 'ser_' + supportHash([id, uid, read.requestId]) || read.caseVersion !== supportVersion(record) ||
        read.authTime !== request.auth.token.auth_time || !Number.isSafeInteger(read.readAtMs) || read.readAtMs > Date.now() ||
        read.readAtMs < Date.now() - 30 * 60_000 || !evidence || supportHash(read.evidence) !== supportHash(expected) ||
        supportHash(reviewEvidenceView(evidence).evidence) !== supportHash(expected)) {
      throw new HttpsError('failed-precondition', 'Relisez les pièces natives avec votre connexion actuelle avant de décider.');
    }
    await assertStoredAccountSecuritySession(tx, uid, read.authTime);
    purposes.add(evidence.purpose); purposeReads.push({readId: selected.readId, purpose: evidence.purpose}); evidenceReads.push({readId: selected.readId as string, evidence: expected});
  }
  const obligations = await selectedAccountObligations(tx, {...record, relatedAccountIds: [subjectUid]}, review.obligations ?? [], true);
  if (representation && (!obligations.length || review.identityDocumentsReviewed !== true || review.authorityDocumentsReviewed !== true ||
      !purposes.has('identity') || !purposes.has('authority') || subjectUid === record.ownerId)) {
    throw new HttpsError('failed-precondition', 'Les pièces d’identité et de pouvoir ainsi que les obligations sélectionnées doivent être examinées.');
  }
  if (!representation && !providerFinding && !activityFinding && (review.identityDocumentsReviewed !== true || review.accountRelationshipReviewed !== true ||
      !purposes.has('identity') || !purposes.has('relationship'))) {
    throw new HttpsError('failed-precondition', 'Les pièces d’identité et de rapprochement doivent être lues et leur examen explicitement attesté.');
  }
  const activityAssessment = activityFinding ? qualifyActivityAssessment(review.activityAssessment, purposeReads, review.finding) : null;
  if (activityFinding && (review.identityDocumentsReviewed !== true || !purposes.has('identity') || !purposes.has('activity') || !purposes.has('regulatory_basis'))) {
    throw new HttpsError('failed-precondition', 'Les pièces natives d’identité, d’activité et de fondement doivent être effectivement lues.');
  }
  if (!activityFinding && review.activityAssessment != null) throw new HttpsError('invalid-argument', 'Programme d’activité incompatible avec ce dossier.');
  if (!representation && obligations.length) throw new HttpsError('invalid-argument', 'Cette décision ne porte pas sur des obligations de représentation.');
  const targetRef = db.collection('users').doc(subjectUid), targetSnapshot = await tx.get(targetRef), target = targetSnapshot.data();
  let postClosureBasis: Awaited<ReturnType<typeof import('../utils/exceptionalRestitutionSources').readExceptionalPostClosureBasis>> = null;
  if (!target && representation && obligations.some(item => item.kind === 'wallet' && item.id === subjectUid)) {
    const closure = (await tx.get(db.collection('eligibility_profiles').doc(subjectUid))).data()?.accountClosure;
    postClosureBasis = await (await import('../utils/exceptionalRestitutionSources')).readExceptionalPostClosureBasis(tx, subjectUid, closure);
  }
  if (!target && !postClosureBasis) throw new HttpsError('failed-precondition', 'Le compte déclaré ou sa fermeture native avec crédit tardif doivent être rapprochés avant une décision.');
  const targetProfileRef = db.collection('eligibility_profiles').doc(subjectUid), targetProfile = (await tx.get(targetProfileRef)).data();
  const decisionReceiptId = supportHash([uid, requestId]), restriction = targetProfile?.supportAccountRestriction;
  let userPatch: Record<string, unknown> | null = null;
  let restrictionPatch: Record<string, unknown> | null = null;
  if (review.finding === 'restrict_new_operations') {
    if (target!.isActive != null && target!.isActive !== true || restriction != null || review.expectedRestrictionReceiptId != null) {
      throw new HttpsError('failed-precondition', 'Une restriction indépendante existe déjà ; elle ne peut pas être remplacée.');
    }
    userPatch = {isActive: false};
    restrictionPatch = {supportAccountRestriction: {protocol: 'support_account_restriction_v1', supportRequestId: id,
      subjectUid, decisionReceiptId, recordedBy: uid, recordedAtMs: Date.now(), reviewDueAtMs,
      appliedAt: FieldValue.serverTimestamp(),
      previousIsActivePresent: Object.prototype.hasOwnProperty.call(target!, 'isActive'), previousIsActive: target!.isActive ?? null}};
  } else if (review.finding === 'lift_own_restriction') {
    if (!restriction || restriction.protocol !== 'support_account_restriction_v1' || restriction.supportRequestId !== id ||
        restriction.subjectUid !== subjectUid || restriction.decisionReceiptId !== review.expectedRestrictionReceiptId || target!.isActive !== false ||
        !(restriction.appliedAt instanceof Timestamp) || !(targetSnapshot.updateTime instanceof Timestamp) ||
        !restriction.appliedAt.isEqual(targetSnapshot.updateTime) ||
        restriction.previousIsActivePresent !== false && (restriction.previousIsActivePresent !== true || restriction.previousIsActive !== true)) {
      throw new HttpsError('failed-precondition', 'Seule la restriction causale de ce dossier peut être levée.');
    }
    const original = (await tx.get(db.collection(C).doc(id).collection('commands').doc(restriction.decisionReceiptId))).data();
    if (original?.state !== 'committed' || original.command?.accountReview?.protocol !== ACCOUNT_REVIEW_V2 ||
        original.command.accountReview.finding !== 'restrict_new_operations' || original.command.accountReview.subjectUid !== subjectUid ||
        original.supportRequestId !== id || restriction.decisionReceiptId !== supportHash([original.actorId, original.requestId])) {
      throw new HttpsError('failed-precondition', 'Le reçu causal de la restriction doit être qualifié.');
    }
    userPatch = {isActive: restriction.previousIsActivePresent ? true : FieldValue.delete()};
    restrictionPatch = {supportAccountRestriction: FieldValue.delete()};
  } else if (activityFinding && review.finding === 'activity_restriction_maintained') {
    if (!restriction || restriction.protocol !== 'support_account_restriction_v1' || restriction.supportRequestId !== id ||
        restriction.subjectUid !== subjectUid || restriction.decisionReceiptId !== review.expectedRestrictionReceiptId || target!.isActive !== false) {
      throw new HttpsError('failed-precondition', 'Le maintien exige la restriction causale actuelle de ce dossier.');
    }
    const original = (await tx.get(db.collection(C).doc(id).collection('commands').doc(restriction.decisionReceiptId))).data();
    if (original?.state !== 'committed' || original.command?.accountReview?.finding !== 'restrict_new_operations' ||
        original.command?.accountReview?.subjectUid !== subjectUid || original.supportRequestId !== id ||
        restriction.decisionReceiptId !== supportHash([original.actorId, original.requestId])) {
      throw new HttpsError('failed-precondition', 'Reçu causal de restriction requis.');
    }
  } else if (review.expectedRestrictionReceiptId != null) throw new HttpsError('invalid-argument', 'Référence de restriction incompatible.');
  let providerSource: any = null;
  if (providerFinding) {
    if (!provider || provider.subjectUid !== subjectUid || !/^spo_[a-f0-9]{64}$/.test(review.providerObservationId ?? '')) throw new HttpsError('failed-precondition', 'Observation native du compte de paiement requise.');
    const observed = (await tx.get(db.collection(C).doc(id).collection('provider_observations').doc(review.providerObservationId))).data();
    if (!observed || observed.actorUid !== uid || observed.authTime !== request.auth.token.auth_time || observed.version !== supportVersion(record) ||
        observed.subjectUid !== subjectUid || observed.accountId !== target!.stripeAccountId || observed.providerSourceHash !== provider.providerSourceHash ||
        observed.observedAtMs > Date.now() || observed.observedAtMs < Date.now() - 5 * 60_000 || provider.observedAtMs < Date.now() - 5 * 60_000) {
      throw new HttpsError('aborted', 'Le compte de paiement a changé. Relisez son état natif.');
    }
    providerSource = {observationId: review.providerObservationId, accountId: observed.accountId,
      providerSourceHash: provider.providerSourceHash, ownerRestriction: provider.ownerRestriction, observedAtMs: provider.observedAtMs};
  } else if (review.providerObservationId != null) throw new HttpsError('invalid-argument', 'Observation de paiement incompatible.');
  const accountReview = {protocol: ACCOUNT_REVIEW_V2, finding: review.finding, subjectUid, reason, ownerMessage, recourse,
    reviewDueAt: new Date(reviewDueAtMs).toISOString(), sources, evidenceReads, obligations, providerSource, activityAssessment, postClosureBasis,
    identityDocumentsReviewed: review.identityDocumentsReviewed === true, authorityDocumentsReviewed: review.authorityDocumentsReviewed === true,
    accountRelationshipReviewed: review.accountRelationshipReviewed === true,
    representationAuthorityVerified: review.finding === 'representation_authority_confirmed',
    authorityScope: representation ? 'selected_existing_obligations_only' : 'new_operations_only',
    representativeUid: representation ? record.ownerId : null, decisionReceiptId, recordedBy: uid,
    recordedAt: new Date().toISOString(), legalIdentityAutomaticallyVerified: false, ...accountV2Effects};
  const notice = await prepareOperationalNotices(tx, [...new Set([record.ownerId, subjectUid])].map(userId => ({userId,
    eventKey: `support_account_review_v2:${id}:${uid}:${requestId}:${userId}`, type: 'account_security',
    title: 'Décision humaine sur un compte', message: userId === record.ownerId ? 'Une décision motivée et sa voie de recours sont disponibles dans votre dossier privé.'
      : 'Une décision humaine concernant vos nouvelles opérations a été consignée. Contactez le support depuis votre propre compte pour sa motivation et la contester.',
    data: {ownerId: userId, supportRequestId: userId === record.ownerId ? id : '', financialEffectAuthorized: 'false'}})));
  return {patch: {accountReview, ownerMessage, status: 'needs_information'}, commit: () => {
    if (userPatch) tx.update(targetRef, userPatch);
    if (restrictionPatch) tx.set(targetProfileRef, restrictionPatch, {merge: true});
    notice.commit();
  }};
}
async function qualifyOrder(tx: FirebaseFirestore.Transaction, id: string, ownerId: string) {
  const snap = await tx.get(db.collection('transactions').doc(id)), record = snap.data();
  if (!record || (record.buyerId !== ownerId && record.sellerId !== ownerId)) throw new HttpsError('permission-denied', 'Commande privée non autorisée.');
  return record;
}
async function limitNewCommand(uid: string, mode: string, ref: FirebaseFirestore.DocumentReference, admin = false) {
  if (mode === 'observe' || (await ref.get()).exists) return;
  await checkRateLimit(uid, true, { functionName: admin ? 'administerSupportRequest' : 'commandSupportRequest',
    maxCallsAuthenticated: admin ? 30 : 10, maxCallsUnauthenticated: 0, windowMs: 60_000 });
}
/** Also used by the legacy callable name: it now needs an exact decision source. */
export async function executeSupportOwnerCommand(request: any) {
  return withFinancialRecoveryScope({operation: 'support.owner'}, () => withPrivateAccountSession(request, async () => {
  if (request.data?.capability === ACCOUNT_REVIEW_V2 && accountEvidenceOperations.includes(request.data?.operation)) return handleAccountReviewEvidence(request, 'owner');
  if (request.data?.capability === ACCOUNT_CONTROL_PROOF_CAPABILITY) return handleAccountControlProof(request, 'owner');
  if (request.data?.capability === SUPPORT_PRIVACY_OPERATIONS_CAPABILITY) return handleSupportPrivacyOperations(request, 'owner');
  if (request.data?.capability === BUSINESS_CESSATION_CAPABILITY) return handleBusinessCessation(request, 'owner');
  if (request.data?.capability === SELLER_TAX_REPORTING_CAPABILITY) return handleSellerTaxReporting(request, 'owner');
  if (request.data?.capability === SUPPORT_CONFIDENTIALITY_CAPABILITY) return handleSupportConfidentiality(request, 'owner');
  if (request.data?.capability === ACCOUNT_RELATIONSHIP_CAPABILITY) return handleAccountRelationshipReview(request, 'owner');
  if (request.data?.capability === LATE_TRANSPORT_RECOVERY_CAPABILITY) return handleLateTransportRecovery(request, 'owner');
  const { uid, data, requestId, command, id, hash } = parseEnvelope(request), ref = db.collection(C).doc(id), opRef = commandRef(id, uid, requestId);
  await limitNewCommand(uid, data.mode, opRef);
  return db.runTransaction(async tx => {
    await assertPrivateAccountSession(request, tx);
    const receipt = (await tx.get(opRef)).data(), rawCurrent = (await tx.get(ref)).data();
    assertNotAuthorityRequest(rawCurrent);
    if (receipt) assertReplay(receipt, uid, id, requestId, hash);
    let guard: any;
    try {guard = materializeSupportConfidentialGuard(await readSupportConfidentialCommandGuard(tx, id, uid, requestId, hash), receipt?.command ?? command);}
    catch (error) {if (!receipt) throw error; guard = {protocol: 'unknown'};}
    if (receipt) return receiptView(receipt, true, rawCurrent, guard);
    if (data.mode === 'observe') return observeView(uid, id, requestId, command, hash);
    const current = rawCurrent ? confidentialSupportRecord(rawCurrent, command, guard) : rawCurrent;
    if (current && current.ownerId !== uid) throw new HttpsError('permission-denied', 'Dossier privé non autorisé.');
    const nowMs = Date.now();
    if (command.action === 'submit') {
      if (current) throw new HttpsError('failed-precondition', 'Dossier existant sans reçu qualifié.');
      if (!(SUPPORT_KINDS as readonly unknown[]).includes(command.kind)) throw new HttpsError('invalid-argument', 'Type de demande invalide.');
      if (['payment_account_review', 'activity_compliance_review'].includes(command.kind) && data.capability !== ACCOUNT_REVIEW_V2) throw new HttpsError('invalid-argument', 'Le parcours de compte de paiement nécessite sa version actuelle.');
      const narrative = supportText(command.narrative, 'Description'), priorId = command.priorSupportRequestId == null ? null : supportId(command.priorSupportRequestId);
      const transactionId = command.transactionId == null ? null : supportId(command.transactionId);
      const swapAssistance = command.kind === 'swap_hold_assistance';
      const swapDecisionReview = command.kind === 'automated_decision_review' && command.swapId != null;
      const withdrawalAssistance = command.kind === 'withdrawal_timing_assistance';
      const withdrawalRequestId = withdrawalAssistance ? supportId(command.withdrawalRequestId, 'Retrait lié') : null;
      if ((!withdrawalAssistance && command.withdrawalRequestId != null) || withdrawalAssistance &&
          (command.transactionId != null || command.meetupReason != null || command.decision != null || command.lateTransport != null || command.swapId != null || command.returnToSender != null ||
            command.evidence != null && (!Array.isArray(command.evidence) || command.evidence.length !== 0))) {
        throw new HttpsError('invalid-argument', 'L’assistance au délai doit référencer ce retrait uniquement.');
      }
      const swapId = swapAssistance || swapDecisionReview ? supportId(command.swapId, 'Troc lié') : null;
      if ((!swapAssistance && !swapDecisionReview && command.swapId != null) || swapAssistance &&
          (command.transactionId != null || command.meetupReason != null || command.decision != null || command.lateTransport != null || command.returnToSender != null ||
            command.evidence != null && (!Array.isArray(command.evidence) || command.evidence.length !== 0)) || swapDecisionReview &&
          (transactionId !== null || command.meetupReason != null || command.lateTransport != null || command.returnToSender != null)) {
        throw new HttpsError('invalid-argument', 'Une assistance à la retenue Troc doit référencer ce Troc uniquement.');
      }
      const accountKind = (ACCOUNT_SUPPORT_KINDS as readonly unknown[]).includes(command.kind);
      const relatedAccountIds = accountKind ? declaredSupportAccounts(command.relatedAccountIds) : [];
      const representation = command.kind === 'representation_review' ? declaredSupportRepresentation(command.representation) : null;
      if ((!accountKind && command.relatedAccountIds != null) || (command.kind !== 'representation_review' && command.representation != null)) {
        throw new HttpsError('invalid-argument', 'Déclarations de comptes ou représentation incompatibles avec le motif.');
      }
      const meetupReason = command.meetupReason ?? null;
      if (meetupReason !== null && (!(MEETUP_SUPPORT_REASONS as readonly unknown[]).includes(meetupReason) || command.kind !== 'commercial_late' || !transactionId)) {
        throw new HttpsError('invalid-argument', 'Motif de rencontre et commande liés requis.');
      }
      const reject = (reason: string) => {
        const value = { protocol, ownerId: uid, actorId: uid, supportRequestId: id, requestId, action: command.action,
          actorRole: 'owner',
          payloadHash: hash, state: 'not_executed', resultVersion: null, recordedAtMs: nowMs, reason, ownerSnapshot: null, command };
        tx.create(opRef, value);
        return receiptView(value, false, rawCurrent, guard);
      };
      if (data.mode === 'neutralize') return reject('command_neutralized');
      if (command.lateCommercial !== undefined && !LATE_COMMERCIAL_ENABLED) return reject('late_commercial_recourse_not_exposed');
      let withdrawalTimingContext = null;
      if (withdrawalAssistance && withdrawalRequestId) {
        const source = await readSupportWithdrawalTimingSource(tx, withdrawalRequestId, uid);
        if (!source || !source.sourceRevision) return reject('withdrawal_context_not_authorized');
        withdrawalTimingContext = { protocol: 'support_withdrawal_timing_context_v1', withdrawalRequestId,
          sourceRevision: source.sourceRevision, sourceHash: source.sourceHash, sourceQualification: source.sourceQualification,
          recordedAt: new Date(nowMs).toISOString(), declaredIssueSource: 'owner_narrative',
          bankReceiptVerified: false, financialEffectAuthorized: false };
      }
      let swapHoldContext = null;
      if (swapAssistance && swapId) {
        const swapSnap = await tx.get(db.collection('swaps').doc(swapId)), swap = swapSnap.data(), revision = supportRevision(swapSnap);
        if (!swap || typeof swap.initiatorId !== 'string' || !swap.initiatorId || typeof swap.receiverId !== 'string' ||
            !swap.receiverId || swap.initiatorId === swap.receiverId || ![swap.initiatorId, swap.receiverId].includes(uid) || !revision) {
          return reject('swap_context_not_authorized');
        }
        swapHoldContext = { protocol: 'support_swap_hold_context_v1', swapId,
          participantRole: swap.initiatorId === uid ? 'initiator' : 'receiver', sourceRevision: revision,
          recordedAt: new Date(nowMs).toISOString(), declaredIssueSource: 'owner_narrative',
          financialExecutionVerified: false, holdReleased: false, physicalReceiptVerified: false };
      }
      if (command.kind === 'commercial_late' && !transactionId) throw new HttpsError('invalid-argument', 'Commande liée requise.');
      if (transactionId) {
        try { await qualifyOrder(tx, transactionId, uid); }
        catch (error) { if (error instanceof HttpsError && error.code === 'permission-denied') return reject('context_not_authorized'); throw error; }
      }
      let lateTransport = null;
      if (command.lateTransport != null) {
        if (command.kind !== 'commercial_late' || !transactionId || meetupReason != null) throw new HttpsError('invalid-argument', 'Incident transport et commande commerciale liés requis.');
        const expected = supportLateTransportReference(command.lateTransport);
        if (expected.transactionId !== transactionId) throw new HttpsError('invalid-argument', 'La référence doit porter sur cette commande.');
        const source = await readLateTransportSupportSource(tx, transactionId, expected.incidentId, uid);
        if (!source || supportHash(source.reference) !== supportHash(expected)) return reject('transport_source_changed');
        lateTransport = source.reference;
      }
      let returnToSender = null;
      if (command.returnToSender != null) {
        if (command.kind !== 'commercial_late' || !transactionId || meetupReason != null || command.lateTransport != null) {
          throw new HttpsError('invalid-argument', 'Un signalement retour à l’expéditeur doit référencer sa commande uniquement.');
        }
        const expected = supportReturnToSenderReference(command.returnToSender);
        if (expected.transactionId !== transactionId) throw new HttpsError('invalid-argument', 'La référence doit porter sur cette commande.');
        const source = await readReturnToSenderSupportSource(tx, transactionId, expected.caseId, uid);
        if (!source || supportHash(source.reference) !== supportHash(expected)) return reject('transport_source_changed');
        returnToSender = source.reference;
      }
      const prior = priorId ? (await tx.get(db.collection(C).doc(priorId))).data() : null;
      if (priorId && (!prior || prior.ownerId !== uid || prior.kind !== command.kind || prior.transactionId !== transactionId ||
          (swapAssistance || swapDecisionReview) && prior.swapId !== swapId || withdrawalAssistance && prior.withdrawalRequestId !== withdrawalRequestId)) {
        return reject('prior_context_not_authorized');
      }
      let decision = null;
      if (command.kind === 'automated_decision_review') {
        const source = supportObject(command.decision, ['id', 'revision', 'sourceHash']);
        const snap = await tx.get(db.collection('automatic_decisions_log').doc(supportId(source.id))), entry = snap.data();
        const ownAdmission = transactionId === null && entry?.protocol === 'admission_refused_v1' && entry.decisionType === 'admission_refused' &&
          entry.ownerId === uid && entry.userId === uid && entry.transactionId === null;
        if (!entry || transactionId === null && !ownAdmission && !swapDecisionReview || transactionId !== null && entry.transactionId !== transactionId) {
          return reject('decision_source_changed');
        }
        let view;
        try {
          if (swapDecisionReview) {
            const native = await readNativeSwapFundReleaseLog(tx, uid, swapId!);
            if (native.journalState !== 'recorded' || !native.entry || native.entry.id !== snap.id) return reject('decision_source_changed');
            view = {...native.entry, financialExecutionVerified: false};
          } else view = decisionView(snap);
        }
        catch { return reject('decision_source_changed'); }
        if (!view?.revision ||
            source.revision !== view.revision || source.sourceHash !== view.sourceHash) {
          return reject('decision_source_changed');
        }
        if (prior && prior.decision?.id !== view.id) return reject('prior_context_not_authorized');
        decision = view;
      } else if (command.decision != null) throw new HttpsError('invalid-argument', 'Une décision liée nécessite un examen automatisé.');
      let evidence: Awaited<ReturnType<typeof qualifySupportEvidence>>;
      try { evidence = await qualifySupportEvidence(tx, uid, command.evidence, meetupReason ? transactionId : null); }
      catch (error) { if (error instanceof HttpsError && error.code === 'permission-denied') return reject('evidence_not_authorized'); throw error; }
      if (meetupReason && !evidence.some(item => item.kind === 'meetup_declaration' && item.id === transactionId)) {
        throw new HttpsError('invalid-argument', 'La déclaration ou l’accord exact de cette rencontre doit être lié.');
      }
      if (meetupReason && evidence.some(item => item.kind === 'meetup_declaration' && item.id !== transactionId)) return reject('evidence_context_mismatch');
      const receivedAtMs = prior?.receivedAtMs ?? nowMs, receivedCivilDate = prior?.receivedCivilDate ?? quebecCivilDate(new Date(nowMs))!;
      const record = { schemaVersion: 1, ownerId: uid, kind: command.kind, status: 'submitted', version: 1, narrative,
        receivedAtMs, receivedCivilDate, statutoryDueDate: prior?.statutoryDueDate ?? supportDueDate(command.kind, receivedCivilDate),
        recordedAtMs: nowMs, updatedAtMs: nowMs, priorSupportRequestId: priorId, transactionId, decision, evidence, meetupReason,
        relatedAccountIds, representation,
        ...(lateTransport ? { lateTransport } : {}),
        ...(swapHoldContext ? { swapId, swapHoldContext } : {}),
        ...(swapDecisionReview ? {swapId} : {}),
        ...(withdrawalTimingContext ? { withdrawalRequestId, withdrawalTimingContext } : {}),
        ...(returnToSender ? { returnToSender } : {}),
        clockOriginSupportRequestId: prior?.clockOriginSupportRequestId ?? priorId ?? id,
        discoveredAt: supportDeclaredDate(command.discoveredAt, nowMs), interruptionAt: supportDeclaredDate(command.interruptionAt, nowMs) };
      const lateLink = await prepareLateCommercialSupportLink(tx, id, record, uid, requestId, hash, command.lateCommercial);
      const linkedRecord = confidentialSupportRecord({...record, ...lateLink}, command, guard);
      const retention = await preparePrivacyRetention(tx, id, linkedRecord, uid, requestId, hash, command.privacyScope);
      tx.create(ref, {...linkedRecord, ...(retention ? {privacyRetention: retention.hold} : {})});
      retention?.commit();
      return recordCommand(tx, opRef, id, uid, requestId, command, hash, linkedRecord, nowMs);
    }
    if (!current) throw new HttpsError('not-found', 'Dossier introuvable.');
    if (data.mode === 'neutralize') return recordCommand(tx, opRef, id, uid, requestId, command, hash, current, nowMs, 'command_neutralized');
    if (supportVersion(current) !== command.expectedVersion) return recordCommand(tx, opRef, id, uid, requestId, command, hash, current, nowMs, 'source_changed');
    if (command.lateCommercial !== undefined && !LATE_COMMERCIAL_ENABLED) return recordCommand(tx, opRef, id, uid, requestId, command, hash, current, nowMs, 'late_commercial_recourse_not_exposed');
    if (['withdrawn', 'answered'].includes(current.status)) return recordCommand(tx, opRef, id, uid, requestId, command, hash, current, nowMs, 'request_closed');
    let patch: Record<string, unknown>;
    if (command.action === 'clarify') {
      patch = { latestClarification: supportText(command.narrative, 'Précisions'), status: 'submitted' };
    } else if (command.action === 'withdraw') {
      patch = { status: 'withdrawn', withdrawnAtMs: nowMs, withdrawalReason: supportText(command.narrative, 'Motif du retrait') };
    } else {
      if (current.meetupReason && (typeof current.transactionId !== 'string' || !current.transactionId || current.transactionId.includes('/'))) {
        return recordCommand(tx, opRef, id, uid, requestId, command, hash, current, nowMs, 'source_context_unqualified');
      }
      let evidence: Awaited<ReturnType<typeof qualifySupportEvidence>>;
      try { evidence = await qualifySupportEvidence(tx, uid, command.evidence, current.meetupReason ? current.transactionId : null); }
      catch (error) {
        if (error instanceof HttpsError && error.code === 'permission-denied') return recordCommand(tx, opRef, id, uid, requestId, command, hash, current, nowMs, 'evidence_not_authorized');
        throw error;
      }
      if (!evidence.length) throw new HttpsError('invalid-argument', 'Référence privée requise.');
      if (current.meetupReason && evidence.some(item => item.kind === 'meetup_declaration' && item.id !== current.transactionId)) {
        return recordCommand(tx, opRef, id, uid, requestId, command, hash, current, nowMs, 'evidence_context_mismatch');
      }
      const all = [...(current.evidence ?? []), ...evidence];
      if (all.length > 30) throw new HttpsError('resource-exhausted', 'Limite de références atteinte.');
      patch = { evidence: all, latestClarification: supportText(command.narrative, 'Description du nouvel élément') };
    }
    const next = { ...current, ...patch, version: current.version + 1, updatedAtMs: nowMs };
    const lateLink = await prepareLateCommercialSupportLink(tx, id, next, uid, requestId, hash, command.lateCommercial);
    if (lateLink) Object.assign(next, lateLink);
    const retention = await preparePrivacyRetention(tx, id, next, uid, requestId, hash, command.privacyScope);
    tx.update(ref, { ...patch, ...lateLink, version: next.version, updatedAtMs: nowMs, ...(retention ? {privacyRetention: retention.hold} : {}) });
    retention?.commit();
    return recordCommand(tx, opRef, id, uid, requestId, command, hash, next, nowMs);
  });

  }));
}
export const commandSupportRequest = onCall(SUPPORT_OPTIONS, executeSupportOwnerCommand);

export const administerSupportRequest = onCall({...SUPPORT_OPTIONS, secrets: providerSecretsForDeployment(['STRIPE_SECRET_KEY'])}, async request => {
  if (request.data?.capability === BUSINESS_CESSATION_CAPABILITY) return handleBusinessCessation(request, 'admin');
  if (request.data?.capability === SUPPORT_PRIVACY_OPERATIONS_CAPABILITY) return handleSupportPrivacyOperations(request, 'admin');
  return withFinancialRecoveryScope({operation: 'support.admin'}, () => withPrivateAccountSession(request, async () => {
  if (request.data?.capability === SUPPORT_LEGAL_REVIEW_CAPABILITY) {
    if (request.data.area === 'confidential_original') return handleSupportOriginalV2(request, 'admin');
    if (request.data.area === 'authority_request') return handleAuthorityRequestV2(request, 'admin');
    throw new HttpsError('invalid-argument', 'Périmètre de revue confidentielle invalide.');
  }
  if (request.data?.capability === ACCOUNT_REVIEW_V2 && accountEvidenceOperations.includes(request.data?.operation)) return handleAccountReviewEvidence(request, 'admin');
  if (request.data?.capability === SELLER_TAX_REPORTING_CAPABILITY) return handleSellerTaxReporting(request, 'admin');
  if (request.data?.capability === SELLER_ACTIVITY_REVIEW_CAPABILITY) {
    if (!['execute', 'observe', 'neutralize'].includes(request.data?.mode)) throw new HttpsError('invalid-argument', 'Commande de vérification d’activité invalide.');
    return handleSellerActivityReview(request);
  }
  if (request.data?.capability === GLOBAL_FINANCIAL_RECONCILIATION_CAPABILITY) {
    if (!['prepare', 'advance', 'seal'].includes(request.data?.mode)) throw new HttpsError('invalid-argument', 'Commande de rapprochement invalide.');
    return handleGlobalFinancialReconciliation(request);
  }
  if (request.data?.capability === AUTHORITY_REQUEST_CAPABILITY) return handleAuthorityRequestCommand(request);
  if (request.data?.capability === SUPPORT_CONFIDENTIALITY_CAPABILITY) return handleSupportConfidentiality(request, 'admin');
  if (request.data?.capability === ACCOUNT_RELATIONSHIP_CAPABILITY) return handleAccountRelationshipReview(request, 'admin');
  if (request.data?.capability === LATE_TRANSPORT_RECOVERY_CAPABILITY) return handleLateTransportRecovery(request, 'admin');
  const { uid, data, requestId, command, id, hash } = parseEnvelope(request, true), ref = db.collection(C).doc(id), opRef = commandRef(id, uid, requestId);
  const privacyServicing = data.privacyRetentionCapability === PRIVACY_RETENTION_CAPABILITY;
  // Role is checked inside the same transaction as the instruction as well.
  if (!privacyServicing) await db.runTransaction(async tx => supportAdmin(tx, uid, (await assertPrivateAccountSession(request, tx)).currentAdminClaim));
  await limitNewCommand(uid, data.mode, opRef, true);
  const providerReview = command.action === 'record_account_review' && command.accountReview?.protocol === ACCOUNT_REVIEW_V2 &&
    typeof command.accountReview.finding === 'string' && command.accountReview.finding.startsWith('provider_') && data.mode === 'execute' && !(await opRef.get()).exists
    ? await providerAccountReviewObservation(request, id, supportAccountUid(command.accountReview.subjectUid)) : null;
  return db.runTransaction(async tx => {
    await assertPrivateAccountSession(request, tx);
    if (!privacyServicing) await supportAdmin(tx, uid, (await assertPrivateAccountSession(request, tx)).currentAdminClaim);
    const receipt = (await tx.get(opRef)).data(), rawCurrent = (await tx.get(ref)).data();
    if (command.action === 'record_account_review' && command.accountReview?.protocol === ACCOUNT_REVIEW_V2 &&
        receipt?.protocol === ACCOUNT_REVIEW_RECEIPT_V2) {
      return accountReceiptView({operation: 'account_review_decision_receipt', actorId: uid, supportRequestId: id,
        requestId, payloadHash: hash, expectedVersion: command.expectedVersion, purpose: null}, receipt);
    }
    assertNotAuthorityRequest(rawCurrent);
    if (receipt) assertReplay(receipt, uid, id, requestId, hash);
    let guard: any;
    try {guard = materializeSupportConfidentialGuard(await readSupportConfidentialCommandGuard(tx, id, uid, requestId, hash), receipt?.command ?? command);}
    catch (error) {if (!receipt) throw error; guard = {protocol: 'unknown'};}
    if (receipt) return receiptView(receipt, true, rawCurrent, guard);
    if (data.mode === 'observe') return observeView(uid, id, requestId, command, hash);
    const current = rawCurrent ? confidentialSupportRecord(rawCurrent, command, guard) : rawCurrent;
    if (privacyServicing && data.mode === 'neutralize') {
      const value = {protocol, ownerId: null, actorId: uid, supportRequestId: id, requestId, action: command.action,
        actorRole: 'admin', payloadHash: hash, state: 'not_executed', resultVersion: null, recordedAtMs: Date.now(),
        reason: 'command_neutralized', ownerSnapshot: null, command};
      tx.create(opRef, value); return receiptView(value, false);
    }
    if (!current) throw new HttpsError('not-found', 'Dossier introuvable.');
    if (privacyServicing && !isPrivacyRequest(current.kind)) throw new HttpsError('invalid-argument', 'Cette capacité concerne une demande de confidentialité.');
    if (isPrivacyRequest(current.kind)) {
      await supportAdmin(tx, uid, await supportCurrentAdminSession(request));
      assertRecentAccountAuthentication(request.auth!.token);
      await assertAccountSecurityOpen((await tx.get(db.collection('eligibility_profiles').doc(uid))).data(), tx, uid);
    }
    const nowMs = Date.now();
    if (data.mode === 'neutralize') return recordCommand(tx, opRef, id, uid, requestId, command, hash, current, nowMs, 'command_neutralized');
    if (supportVersion(current) !== command.expectedVersion) return recordCommand(tx, opRef, id, uid, requestId, command, hash, current, nowMs, 'source_changed');
    const terminal = ['withdrawn', 'answered'].includes(current.status);
    if (terminal && command.action !== 'internal_note') return recordCommand(tx, opRef, id, uid, requestId, command, hash, current, nowMs, 'request_closed');
    let patch: Record<string, unknown>;
    let accountReviewCommit: (() => void) | null = null;
    let transportNotices: Awaited<ReturnType<typeof prepareOperationalNotices>> | null = null;
    if (command.action === 'assign') {
      const assignedAdminId = supportAccountUid(command.assignedAdminId);
      // Target availability is current too; self-assignment is no shortcut.
      // Prior native receipts returned above remain readable without reassigning.
      try {
        const assignedAdminClaim = await supportCurrentAdminClaim(assignedAdminId);
        await supportAdmin(tx, assignedAdminId, assignedAdminClaim);
      } catch (error) {
        const authMissing = typeof error === 'object' && error !== null && 'code' in error && error.code === 'auth/user-not-found';
        if (authMissing || (error instanceof HttpsError && error.code === 'permission-denied')) {
          return recordCommand(tx, opRef, id, uid, requestId, command, hash, current, nowMs, 'assignment_target_not_qualified');
        }
        throw error; // Auth/transaction failure is unknown, never a fabricated refusal.
      }
      patch = { assignedAdminId };
    } else if (command.action === 'internal_note') {
      patch = { internalNote: supportText(command.internalNote, 'Note interne') };
    } else if (command.action === 'record_account_review') {
      if (!(ACCOUNT_SUPPORT_KINDS as readonly unknown[]).includes(current.kind)) throw new HttpsError('invalid-argument', 'Ce dossier ne porte pas sur des comptes ou une représentation.');
      if (command.accountReview?.protocol === ACCOUNT_REVIEW_V2) {
        const plan = await prepareAccountReviewV2(tx, request, current, id, requestId, command.accountReview, providerReview);
        patch = plan.patch; accountReviewCommit = plan.commit;
      } else {
      if (['payment_account_review', 'activity_compliance_review'].includes(current.kind)) throw new HttpsError('invalid-argument', 'Le compte de paiement nécessite sa version de décision actuelle.');
      const review = supportObject(command.accountReview, ['finding', 'reason', 'expectedSources']);
      if (!(ACCOUNT_REVIEW_FINDINGS as readonly unknown[]).includes(review.finding)) throw new HttpsError('invalid-argument', 'Observation de comptes invalide.');
      const representationFinding = ['representation_not_verified', 'representation_requires_manual_verification'].includes(review.finding);
      if ((representationFinding && current.kind !== 'representation_review') ||
          (current.kind === 'representation_review' && ['no_link_established', 'link_requires_manual_action'].includes(review.finding))) {
        throw new HttpsError('invalid-argument', 'Observation incompatible avec le motif du dossier.');
      }
      const reason = supportText(review.reason, 'Motivation privée');
      const sources = await readSupportAccountSources(tx, current);
      if (!Array.isArray(review.expectedSources) || review.expectedSources.length !== sources.length) throw new HttpsError('invalid-argument', 'Révisions de toutes les sources requises.');
      const expected = review.expectedSources.map((item: unknown) => supportObject(item, ['declaredAccountId', 'sourceHash', 'userRevision', 'eligibilityRevision']));
      for (const item of expected) {
        declaredSupportAccounts([item.declaredAccountId]);
        if (typeof item.sourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(item.sourceHash) ||
            !['userRevision', 'eligibilityRevision'].every(key => item[key] === null || (typeof item[key] === 'string' && /^\d+:\d+$/.test(item[key])))) {
          throw new HttpsError('invalid-argument', 'Empreinte et révisions natives requises.');
        }
      }
      if (new Set(expected.map((item: any) => item.declaredAccountId)).size !== sources.length || sources.some(source => {
        const item = expected.find((entry: any) => entry.declaredAccountId === source.declaredAccountId);
        return !item || item.sourceHash !== source.sourceHash || item.userRevision !== source.userRevision || item.eligibilityRevision !== source.eligibilityRevision;
      })) return recordCommand(tx, opRef, id, uid, requestId, command, hash, current, nowMs, 'account_source_changed');
      patch = { accountReview: { protocol: 'support_account_review_v1', finding: review.finding, reason,
        sources, recordedBy: uid, recordedAt: new Date(nowMs).toISOString(), accountRelationshipVerified: false,
        representationAuthorityVerified: false, restrictionCircumventionEstablished: false,
        otherAccountAccessGranted: false, paymentAuthorityGranted: false, automaticActionTaken: false } };
      }
    } else if (command.action === 'record_transport_instruction') {
      if (current.kind !== 'commercial_late' || (!current.lateTransport && !current.returnToSender) || !current.transactionId) {
        throw new HttpsError('invalid-argument', 'Un dossier d’incident transport lié est requis.');
      }
      const instruction = supportObject(command.transportInstruction, ['type', 'reason', 'ownerMessage', 'source']);
      if (!['return', 'retain', 'regularisation_review'].includes(instruction.type)) throw new HttpsError('invalid-argument', 'Instruction documentaire invalide.');
      const isRts = current.returnToSender != null;
      const expected = isRts ? supportReturnToSenderReference(instruction.source) : supportLateTransportReference(instruction.source);
      const prior = isRts ? supportReturnToSenderReference(current.returnToSender) : supportLateTransportReference(current.lateTransport);
      const sameContext = isRts
        ? 'caseId' in expected && 'caseId' in prior && expected.caseId === prior.caseId &&
          expected.caseRevision === prior.caseRevision && expected.caseHash === prior.caseHash
        : 'incidentId' in expected && 'incidentId' in prior && expected.incidentId === prior.incidentId &&
          expected.incidentRevision === prior.incidentRevision && expected.incidentHash === prior.incidentHash;
      if (expected.transactionId !== current.transactionId || !sameContext) {
        return recordCommand(tx, opRef, id, uid, requestId, command, hash, current, nowMs, 'transport_context_mismatch');
      }
      const source = isRts && 'caseId' in expected
        ? await readReturnToSenderSupportSource(tx, current.transactionId, expected.caseId, current.ownerId)
        : 'incidentId' in expected ? await readLateTransportSupportSource(tx, current.transactionId, expected.incidentId, current.ownerId) : null;
      if (!source || supportHash(source.reference) !== supportHash(expected)) {
        return recordCommand(tx, opRef, id, uid, requestId, command, hash, current, nowMs, 'transport_source_changed');
      }
      const reason = supportText(instruction.reason, 'Motivation'), ownerMessage = supportText(instruction.ownerMessage, 'Instruction communiquée');
      const nativeInstruction = { protocol: 'support_transport_instruction_v1', type: instruction.type, reason, ownerMessage,
        source: source.reference, recordedBy: uid, recordedAt: new Date(nowMs).toISOString(), requestId,
        financialEffect: 'none', recipientReceiptVerified: false, bankReceiptVerified: false,
        inventoryReleaseAuthorized: false, humanExaminationVerified: false };
      transportNotices = await prepareOperationalNotices(tx, [{
        eventKey: `support_transport_instruction_v1:${id}:${uid}:${requestId}`, userId: current.ownerId, type: 'order_moderation',
        title: 'Instruction du support enregistrée', message: 'Une instruction documentaire a été consignée pour votre incident transport. Consultez le dossier de support pour sa motivation et les étapes demandées. Elle ne modifie ni les fonds ni la disponibilité de l’article.',
        data: { ownerId: current.ownerId, transactionId: current.transactionId, supportRequestId: id,
          ...('caseId' in expected ? { returnToSenderCaseId: expected.caseId } : { lateTransportIncidentId: expected.incidentId }),
          supportInstructionRequestId: requestId, financialEffectAuthorized: 'false' },
      }]);
      patch = { transportInstruction: nativeInstruction, ownerMessage, status: 'needs_information' };
    } else if (command.action === 'request_details') {
      patch = { status: 'needs_information', ownerMessage: supportText(command.ownerMessage, 'Précisions demandées') };
    } else {
      const response = supportObject(command.response, ['text', 'legalBasis', 'recourse']);
      const privacy = ['personal_data_access', 'personal_data_correction'].includes(current.kind);
      patch = { status: 'answered', ownerResponse: { text: supportText(response.text, 'Réponse motivée'),
        legalBasis: privacy ? supportText(response.legalBasis, 'Fondement légal') : response.legalBasis == null ? null : supportText(response.legalBasis, 'Fondement légal'),
        recourse: privacy ? supportText(response.recourse, 'Recours communiqué') : response.recourse == null ? null : supportText(response.recourse, 'Recours communiqué'),
        recordedBy: uid, recordedAt: new Date(nowMs).toISOString(), legalQualificationVerified: false,
        dataSearchCompletedVerified: false, externalRecourseDeadlineExtended: false } };
    }
    const supportFieldSources = supportAdminCopySources(current, command,
      {actorId: uid, supportRequestId: id, requestId, payloadHash: hash, action: command.action});
    const next = { ...current, ...patch, supportFieldSources, version: current.version + 1, updatedAtMs: nowMs };
    const retention = await preparePrivacyRetention(tx, id, next, uid, requestId, hash);
    const ownerNotices = (SUPPORT_KINDS as readonly unknown[]).includes(current.kind) &&
      (command.action === 'request_details' || command.action === 'respond')
      ? await prepareOperationalNotices(tx, [{
        eventKey: `support_owner_update_v1:${supportHash([id, uid, requestId])}`,
        userId: current.ownerId, type: 'order_moderation', title: 'Mise à jour du support',
        message: 'Une mise à jour de votre dossier de support est disponible dans votre espace privé.',
        data: { supportUpdateProtocol: 'support_owner_update_v1', ownerId: current.ownerId,
          supportRequestId: id, supportCommandId: supportHash([uid, requestId]), supportAction: command.action,
          supportRequestVersion: String(next.version) },
      }]) : null;
    tx.update(ref, { ...patch, supportFieldSources, version: next.version, updatedAtMs: nowMs, ...(retention ? {privacyRetention: retention.hold} : {}) });
    retention?.commit();
    accountReviewCommit?.();
    transportNotices?.commit();
    ownerNotices?.commit();
    return recordCommand(tx, opRef, id, uid, requestId, command, hash, next, nowMs);
  });

  }));
});

function cursor(value: unknown, field: string) {
  if (value == null) return null;
  const item = supportObject(value, [field, 'id']);
  if (!Number.isSafeInteger(item[field]) || item[field] < 1) throw new HttpsError('invalid-argument', 'Curseur invalide.');
  return { ms: item[field], id: supportId(item.id) };
}
export const readSupportRequests = onCall({...SUPPORT_OPTIONS,secrets:providerSecretsForDeployment(['STRIPE_SECRET_KEY'])}, async request => {
  if (request.data?.capability === BUSINESS_CESSATION_CAPABILITY) return handleBusinessCessation(request, 'read');
  if (request.data?.capability === SUPPORT_PRIVACY_OPERATIONS_CAPABILITY) return handleSupportPrivacyOperations(request, 'read');
  return withFinancialRecoveryScope({operation: 'support.read'}, () => withPrivateAccountSession(request, async () => {
  if (request.data?.capability === SUPPORT_LEGAL_REVIEW_CAPABILITY) {
    if (request.data.area === 'confidential_original') return handleSupportOriginalV2(request, 'read');
    if (request.data.area === 'authority_request') return handleAuthorityRequestV2(request, 'read');
    throw new HttpsError('invalid-argument', 'Périmètre de revue confidentielle invalide.');
  }
  if (request.data?.capability === ACCOUNT_REVIEW_V2 && accountReceiptOperations.includes(request.data?.operation)) return handleAccountReviewReceipt(request);
  if (request.data?.capability === ACCOUNT_REVIEW_V2 && accountEvidenceOperations.includes(request.data?.operation)) return handleAccountReviewEvidence(request, 'read');
  if (request.data?.operation === SUPPORT_DEADLINE_QUEUE_OPERATION) {
    const uid = supportUid(request), data = supportObject(request.data, ['expectedUid', 'scope', 'operation', 'lane', 'queueCursor']);
    if (data.scope !== 'admin' || !['dated', 'unknown', 'bank'].includes(data.lane)) {
      throw new HttpsError('invalid-argument', 'Vue opérateur des échéances invalide.');
    }
    const lane = data.lane as 'dated' | 'unknown' | 'bank', after = supportDeadlineCursor(data.queueCursor, uid, lane);
    const result = await db.runTransaction(async tx => {
      const session = await assertPrivateAccountSession(request, tx);
      await supportAdmin(tx, uid, session.currentAdminClaim);
      return readSupportDeadlinePage(tx, uid, lane, after);
    });
    // Qualify the current role/session again after the complete page read.
    await db.runTransaction(async tx => {
      const session = await assertPrivateAccountSession(request, tx);
      await supportAdmin(tx, uid, session.currentAdminClaim);
    });
    return result;
  }
  if (request.data?.capability === ACCOUNT_CONTROL_PROOF_CAPABILITY) return handleAccountControlProof(request, 'read');
  if (request.data?.capability === SELLER_TAX_REPORTING_CAPABILITY) return handleSellerTaxReporting(request, 'read');
  if (request.data?.capability === FINANCIAL_RECOVERY_STATUS_CAPABILITY) return readFinancialRecoveryStatus(request);
  if (request.data?.capability === CONNECT_IDENTITY_RECOVERY_CAPABILITY) return handleConnectIdentityRecovery(request);
  if (request.data?.capability === SELLER_ACTIVITY_REVIEW_CAPABILITY) {
    if (request.data?.mode !== 'seller_activity_review_preview') throw new HttpsError('invalid-argument', 'Lecture de vérification d’activité invalide.');
    return handleSellerActivityReview(request);
  }
  if (request.data?.capability === GLOBAL_FINANCIAL_RECONCILIATION_CAPABILITY) {
    if (!['observe', 'page', 'capture_point'].includes(request.data?.mode)) throw new HttpsError('invalid-argument', 'Lecture de rapprochement invalide.');
    return handleGlobalFinancialReconciliation(request);
  }
  if (request.data?.capability === AUTHORITY_REQUEST_CAPABILITY) return readAuthorityRequests(request);
  if (request.data?.capability === SUPPORT_CONFIDENTIALITY_CAPABILITY) return handleSupportConfidentiality(request, 'read');
  if (request.data?.capability === ACCOUNT_RELATIONSHIP_CAPABILITY) return handleAccountRelationshipReview(request, 'read');
  if (request.data?.capability === LATE_TRANSPORT_RECOVERY_CAPABILITY) return handleLateTransportRecovery(request, 'read');
  const uid = supportUid(request), data = supportObject(request.data, ['expectedUid', 'scope', 'supportRequestId', 'cursor', 'eventsCursor', 'capability', 'privacyRetentionCapability', 'lateCommercialCapability', 'confidentialityCapability']);
  const confidentiality = data.confidentialityCapability === SUPPORT_CONFIDENTIALITY_CAPABILITY;
  if (data.confidentialityCapability !== undefined && !confidentiality) throw new HttpsError('invalid-argument', 'Version de confinement privé invalide.');
  const lateCommercial = data.lateCommercialCapability === LATE_COMMERCIAL_CAPABILITY;
  if (data.lateCommercialCapability !== undefined && !lateCommercial) throw new HttpsError('invalid-argument', 'Version du recours commercial tardif invalide.');
  const privacy = data.privacyRetentionCapability === PRIVACY_RETENTION_CAPABILITY;
  if (data.privacyRetentionCapability !== undefined && !privacy) throw new HttpsError('invalid-argument', 'Version de conservation privée invalide.');
  if (data.capability !== undefined && !['account_cases_v1', 'account_and_late_transport_v1', 'extended_support_cases_v1', 'extended_support_cases_v2', 'extended_support_cases_v3', ACCOUNT_REVIEW_V2].includes(data.capability)) throw new HttpsError('invalid-argument', 'Capacité de lecture invalide.');
  const accountReviewV2 = data.capability === ACCOUNT_REVIEW_V2;
  const rtsCases = accountReviewV2 || data.capability === 'extended_support_cases_v3';
  const accountCases = rtsCases || ['account_cases_v1', 'account_and_late_transport_v1', 'extended_support_cases_v1', 'extended_support_cases_v2'].includes(data.capability);
  const extendedCases = rtsCases || ['extended_support_cases_v1', 'extended_support_cases_v2'].includes(data.capability);
  const withdrawalCases = rtsCases || data.capability === 'extended_support_cases_v2';
  const lateTransport = rtsCases || ['account_and_late_transport_v1', 'extended_support_cases_v1', 'extended_support_cases_v2'].includes(data.capability);
  if (!['owner', 'admin'].includes(data.scope)) throw new HttpsError('invalid-argument', 'Périmètre invalide.');
  const isAdmin = data.scope === 'admin', id = data.supportRequestId == null ? null : supportId(data.supportRequestId);
  const listCursor = cursor(data.cursor, 'receivedAtMs'), eventCursor = cursor(data.eventsCursor, 'recordedAtMs');
  if (id && listCursor || !id && eventCursor) throw new HttpsError('invalid-argument', 'Curseur incompatible.');
  return db.runTransaction(async tx => {
    await assertPrivateAccountSession(request, tx);
    if (isAdmin) await supportAdmin(tx, uid, (await assertPrivateAccountSession(request, tx)).currentAdminClaim);
    if (id) {
      const ref = db.collection(C).doc(id), currentSnapshot = await tx.get(ref), current = currentSnapshot.data();
      if (!current) throw new HttpsError('not-found', 'Dossier introuvable.');
      assertNotAuthorityRequest(current);
      if (!isAdmin && current.ownerId !== uid) throw new HttpsError('permission-denied', 'Dossier privé non autorisé.');
      if ((!rtsCases && current.returnToSender != null) || !supportKindReadable(current.kind, accountCases, extendedCases, withdrawalCases, accountReviewV2)) throw new HttpsError('failed-precondition',
        'Cette version de l’application ne permet pas de consulter ce dossier. Actualisez l’application.');
      const accountKind = (ACCOUNT_SUPPORT_KINDS as readonly unknown[]).includes(current.kind);
      const accountSources = isAdmin && accountKind ? await readSupportAccountSources(tx, current) : null;
      const transportSource = isAdmin && lateTransport && current.lateTransport
        ? await readLateTransportSupportSource(tx, current.transactionId, supportLateTransportReference(current.lateTransport).incidentId, current.ownerId) : null;
      const swapHoldSource = isAdmin && extendedCases && current.kind === 'swap_hold_assistance'
        ? await readSupportSwapHoldSource(tx, current.swapId, current.ownerId) : null;
      const withdrawalTimingSource = isAdmin && withdrawalCases && current.kind === 'withdrawal_timing_assistance'
        ? await readSupportWithdrawalTimingSource(tx, current.withdrawalRequestId, current.ownerId) : null;
      const returnToSenderSource = isAdmin && rtsCases && current.returnToSender
        ? await readReturnToSenderSupportSource(tx, current.transactionId, supportReturnToSenderReference(current.returnToSender).caseId, current.ownerId) : null;
      let query = ref.collection('commands').orderBy('recordedAtMs', 'desc').orderBy('__name__', 'desc').limit(21);
      if (eventCursor) query = query.startAfter(eventCursor.ms, eventCursor.id);
      const page = await tx.get(query), rows = page.docs.slice(0, 20), hasMore = page.size > 20;
      const guards = await Promise.all(rows.map(doc => {
        const v = doc.data(); return typeof v.actorId === 'string' && typeof v.requestId === 'string' && typeof v.payloadHash === 'string'
          ? readSupportConfidentialCommandGuard(tx, id, v.actorId, v.requestId, v.payloadHash) : null;
      }));
      const events = rows.filter(doc => lateTransport || doc.data().action !== 'record_transport_instruction').map(doc => {
        const raw = doc.data(), value = projectSupportConfidential(raw, current, materializeSupportConfidentialGuard(guards[rows.indexOf(doc)], raw.command)), command = value.command ?? {};
        // Contract actions are disjoint: an admin can also own this dossier.
        // Historical V1 receipts lack actorRole, so classify from the native action.
        const ownerAction = (OWNER_ACTIONS as readonly string[]).includes(value.action);
        const adminAction = (ADMIN_ACTIONS as readonly string[]).includes(value.action);
        return { id: doc.id, action: value.action, state: value.state, resultVersion: value.resultVersion,
          recordedAt: new Date(value.recordedAtMs).toISOString(), recordedAtMs: value.recordedAtMs,
          ownerAction, reason: value.reason ?? null,
          narrative: ownerAction && typeof command.narrative === 'string' ? command.narrative : null,
          ownerMessage: adminAction && value.action === 'request_details' ? command.ownerMessage ?? null : null,
          response: adminAction && value.action === 'respond' ? value.ownerSnapshot?.ownerResponse ?? null : null,
          ...(lateTransport && value.action === 'record_transport_instruction' ? {
            transportInstruction: value.state === 'committed' && value.ownerSnapshot?.transportInstruction?.requestId === value.requestId
              ? supportOwnerSnapshotView(value.ownerSnapshot, true, rtsCases).transportInstruction : null } : {}),
          ...(isAdmin ? { actorId: value.actorId, internalNote: command.internalNote ?? null,
            ...(accountKind ? { accountReview: command.accountReview ?? null } : {}) } : {}) };
      });
      const last = rows.at(-1);
      return { protocol: 'support_read_v1', actorId: uid, scope: data.scope,
        ...(isAdmin ? {sourceRevision: supportRevision(currentSnapshot)} : {}),
        request: {...(isAdmin ? supportAdminView(id, current, lateTransport, rtsCases) : supportOwnerView(id, current, Date.now(), lateTransport, rtsCases)),
          ...(confidentiality ? {confidentiality: supportConfidentialityProjection(current)} : {})},
        ...(privacy && isPrivacyRequest(current.kind) ? {privacyRetention: projectSupportConfidential(privacyRetentionView(current),current)} : {}),
        ...(lateCommercial && current.lateCommercial !== undefined ? {lateCommercial:lateCommercialSupportView(current)} : {}),
        ...(isAdmin && accountKind ? { accountSources } : {}),
        ...(isAdmin && lateTransport ? { transportSource } : {}),
        ...(isAdmin && extendedCases ? { swapHoldSource } : {}),
        ...(isAdmin && withdrawalCases ? { withdrawalTimingSource } : {}),
        ...(isAdmin && rtsCases ? { returnToSenderSource } : {}),
        events: { items: events, hasMore, cursor: hasMore && last ? { recordedAtMs: last.data().recordedAtMs, id: last.id } : null } };
    }
    let query: FirebaseFirestore.Query = db.collection(C);
    if (!isAdmin) query = query.where('ownerId', '==', uid);
    query = query.orderBy('receivedAtMs', 'desc').orderBy('__name__', 'desc').limit(31);
    if (listCursor) query = query.startAfter(listCursor.ms, listCursor.id);
    const page = await tx.get(query), rows = page.docs.slice(0, 30), hasMore = page.size > 30, last = rows.at(-1);
    const visibleRows = rows.filter(doc => !isAuthorityRequest(doc.data()) && (rtsCases || doc.data().returnToSender == null) &&
      supportKindReadable(doc.data().kind, accountCases, extendedCases, withdrawalCases, accountReviewV2));
    return { protocol: 'support_list_v1', actorId: uid, scope: data.scope,
      items: visibleRows.map(doc => ({...(isAdmin ? supportAdminView(doc.id, doc.data(), lateTransport, rtsCases) : supportOwnerView(doc.id, doc.data(), Date.now(), lateTransport, rtsCases)),
        ...(confidentiality ? {confidentiality: supportConfidentialityProjection(doc.data())} : {}),
        ...(privacy && isPrivacyRequest(doc.data().kind) ? {privacyRetention: projectSupportConfidential(privacyRetentionView(doc.data()),doc.data())} : {}),
        ...(lateCommercial && doc.data().lateCommercial !== undefined ? {lateCommercial:lateCommercialSupportView(doc.data())} : {})})),
      // Cursor is the last INSPECTED source, not the last visible item. Hidden
      // account cases cannot loop/skip old records; an empty page can advance.
      hasMore, cursor: hasMore && last ? { receivedAtMs: last.data().receivedAtMs, id: last.id } : null,
      completeHistory: !listCursor && !hasMore && visibleRows.length === rows.length };
  });

  }));
});
