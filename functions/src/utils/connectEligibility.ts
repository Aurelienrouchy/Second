import { FinancialRecoveryBlocked } from "./financialRecoveryInterlock";
/** Private account observation and durable creation; no payment permission. */
import { createHash, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import type StripeConstructor from 'stripe';
type StripeClient = InstanceType<typeof StripeConstructor>;
type StripeCreateParams = Parameters<StripeClient['accounts']['create']>[0];
type StripeCreatedAccount = Awaited<ReturnType<StripeClient['accounts']['create']>>;
import { HttpsError } from 'firebase-functions/v2/https';
import { db, FieldValue } from '../config/firebase';
import { assertNewPaymentsEnabled } from '../config/featureFlags';
import { ageFromIsoDate, parseCivilIsoDate } from '../shared/age';
import { normalizeCanadianAddress } from '../shared/canadianAddress';
import { eligibilityVersion, evaluateCurrentSellerEligibility } from '../shared/eligibility';
import { hasUnavailableAccountStanding } from '../shared/accountStanding';
import { accountSecurityQualifiedProjection, hasAccountSecurityBarrier } from '../shared/accountSecurity';
import { CONNECT_CONSENT_AGREEMENT_URLS, CONNECT_CONSENT_PRESENTATION_VERSION, CONNECT_CONSENT_STATEMENT, CONNECT_CONSENT_TRANSLATIONS_URL } from '../shared/connectConsent';
import { readEligibilityEvidence, assertRecentAccountAuthentication, assertOwnPublicationEligibility } from './eligibility';
import { bankHolderDeclaration, qualifiedCanadianBank, assertExpectedBankActor } from './stripeBank';
import { deriveStripeAccountState, hasUnrestrictedStripeChargeCapability, stripeAccountFirestoreFields } from './stripeAccount';
import {assertConnectIdentityPost,readConnectIdentityClaim,reserveConnectIdentityClaim} from './connectRecoveryIdentity';
import {isDevCommerceStripeTestRuntime} from '../config/runtimeEnvironment';
const validAccountId = (id: unknown): id is string => typeof id === 'string' && /^acct_[A-Za-z0-9_]{1,190}$/.test(id);
const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const unavailable = (recoveryReference?:string) => new HttpsError('unavailable', 'La création du compte doit être rapprochée. Aucun compte de remplacement ne sera créé.',
  { reason: 'connect_creation_unknown', action: 'getStripeAccountStatus',...(recoveryReference?{recoveryReference}:{}) });
type ConnectPrivateGuard = (tx?: FirebaseFirestore.Transaction) => Promise<unknown>;
export interface ConnectObservationBarrier { ownerId: string; revision: number; }
function observationRevision(profile: FirebaseFirestore.DocumentData | null | undefined): number {
  const revision = profile?.connectObservationRevision;
  if (revision === undefined) return 0; // Existing profile, no observation fence yet.
  if (!Number.isSafeInteger(revision) || revision < 0 || revision >= Number.MAX_SAFE_INTEGER) {
    throw new HttpsError('failed-precondition', 'Le suivi du compte nécessite un examen avant actualisation.',
      { reason: 'connect_observation_review_required', action: 'contactSupport' });
  }
  return revision;
}
const staleObservation = () => new HttpsError('aborted', 'Les renseignements du compte ont changé pendant la vérification. Actualisez son statut.',
  { reason: 'connect_observation_stale', action: 'getStripeAccountStatus' });
/** Capture only the provider-observation fence before network IO. DOB, activity
 * and private reviews are re-read at commit, not treated as stale provider IO. */
export async function captureConnectObservationBarrier(uid: string, expectedId: string,
  transactionGuard?: (tx: FirebaseFirestore.Transaction) => Promise<unknown>): Promise<ConnectObservationBarrier> {
  return db.runTransaction(async tx => {
    if (transactionGuard) await transactionGuard(tx);
    const evidence = await readEligibilityEvidence(tx, uid);
    if (!evidence.user) throw new HttpsError('not-found', 'User not found');
    if (evidence.user.stripeAccountId !== expectedId) throw new HttpsError('aborted', 'Le compte lié a changé. Actualisez son statut.');
    if (transactionGuard) await transactionGuard(tx);
    return { ownerId: uid, revision: observationRevision(evidence.profile) };
  });
}
function providerDob(raw: any): string | null {
  if (!raw || !['year', 'month', 'day'].every(key => typeof raw[key] === 'number' && Number.isInteger(raw[key]))) return null;
  const iso = String(raw.year).padStart(4, '0') + '-' + String(raw.month).padStart(2, '0') + '-' + String(raw.day).padStart(2, '0');
  return parseCivilIsoDate(iso) ? iso : null;
}
/** No raw native DOB, notes or full address escapes through this summary. */
export function sellerQuebecSummary(proof: any) {
  if (!proof) return null;
  return { status: typeof proof.status === 'string' ? proof.status : 'review_required',
    source: 'stripe_account_observed', residenceVerified: false, country: proof.country === 'CA' ? 'CA' : null,
    province: proof.province === 'QC' ? 'QC' : null, observedAtMs: Number.isSafeInteger(proof.observedAtMs) ? proof.observedAtMs : null };
}
/** Signed events invalidate an existing observation until a current retrieve.
 * They never grant territory/DOB admission from an out-of-order event payload. */
export async function invalidateConnectObservation(uid: string, accountId: string, userFields: Record<string, unknown> = {}, reason = 'provider_refresh_required') {
  return db.runTransaction(tx => invalidateConnectObservationInTransaction(tx, uid, accountId, userFields, reason));
}
/** Same invalidation, composable with a durable notification in the caller's
 * transaction. All notification reads must precede these writes. */
export async function invalidateConnectObservationInTransaction(tx: FirebaseFirestore.Transaction, uid: string, accountId: string,
  userFields: Record<string, unknown> = {}, reason = 'provider_refresh_required') {
  const userRef = db.collection('users').doc(uid), profileRef = db.collection('eligibility_profiles').doc(uid);
  const user = (await tx.get(userRef)).data(), profile = (await tx.get(profileRef)).data();
  if (!user || user.stripeAccountId !== accountId) throw new HttpsError('aborted', 'La liaison du compte a changé.');
  const prior = profile?.sellerQuebecEvidence;
  // Every relevant signed update fences earlier IO, even with no proof or an
  // already prudent proof. No DOB/declaration/default admission is created.
  const next = { ...profile, connectObservationRevision: observationRevision(profile) + 1,
    ...(prior?.accountId === accountId && prior.status === 'observed' ? {
      sellerQuebecEvidence: { ...prior, status: 'review_required', reasons: [reason],
      identityHash: sha({ previousIdentityHash: prior.identityHash, reason }), invalidatedAtMs: Date.now() },
      version: (Number.isSafeInteger(profile!.version) ? profile!.version : 0) + 1 } : {}) };
  tx.set(profileRef, next);
  if (Object.keys(userFields).length) tx.update(userRef, userFields);
}
/** Retrieve/create is performed by callers OUTSIDE this transaction. */
export async function observeConnectAccount(uid: string, account: any, options: {
  barrier: ConnectObservationBarrier; expectedId?: string; operationId?: string; invalidateOnly?: boolean;
  transactionGuard?: (tx: FirebaseFirestore.Transaction) => Promise<unknown>;
}) {
  if (!validAccountId(account?.id)) throw unavailable();
  return db.runTransaction(async tx => {
    if (options.transactionGuard) await options.transactionGuard(tx);
    const evidence = await readEligibilityEvidence(tx, uid);
    if (!evidence.user) throw new HttpsError('not-found', 'User not found');
    const userRef = db.collection('users').doc(uid), profileRef = db.collection('eligibility_profiles').doc(uid);
    const profile = evidence.profile ?? {}, op = profile.connectOperation;
    const revision = observationRevision(profile);
    if (options.barrier?.ownerId !== uid || options.barrier.revision !== revision) throw staleObservation();
    if (options.expectedId && evidence.user.stripeAccountId !== options.expectedId) throw new HttpsError('aborted', 'Le compte lié a changé. Actualisez son statut.');
    if (options.operationId && op?.id !== options.operationId) throw new HttpsError('aborted', 'La création doit être examinée.');
    if ((evidence.user.stripeAccountId && evidence.user.stripeAccountId !== account.id) ||
        (account.metadata?.firebaseUserId && account.metadata.firebaseUserId !== uid)) throw new HttpsError('failed-precondition', 'La liaison du compte doit être examinée.');
    const dob = providerDob(account.individual?.dob);
    const declaredDob = parseCivilIsoDate(evidence.user.dateOfBirth) ? evidence.user.dateOfBirth : null;
    const address = normalizeCanadianAddress(account.individual?.address ? { street: account.individual.address.line1,
      city: account.individual.address.city, province: account.individual.address.state, postalCode: account.individual.address.postal_code,
      country: account.individual.address.country, ...(account.individual.address.line2 != null ? { line2: account.individual.address.line2 } : {}) } : null);
    const sourceChanged = !!options.operationId && op.authorizedVersion !== eligibilityVersion(evidence);
    const state = deriveStripeAccountState(account), providerRequirements = account.requirements;
    const qualifiedRequirements = !!providerRequirements && typeof providerRequirements === 'object' && !Array.isArray(providerRequirements) &&
      (providerRequirements.disabled_reason === null || typeof providerRequirements.disabled_reason === 'string') &&
      Array.isArray(providerRequirements.past_due) && providerRequirements.past_due.every((field: unknown) => typeof field === 'string');
    const reasons: string[] = [];
    if (account.deleted === true) reasons.push('provider_account_deleted');
    if (!qualifiedRequirements) reasons.push('provider_requirements_unqualified');
    if (!hasUnrestrictedStripeChargeCapability(state)) reasons.push('provider_payment_unavailable');
    if (hasUnavailableAccountStanding(evidence.user)) reasons.push('account_inactive');
    if (account.type !== 'custom' || account.business_type !== 'individual') reasons.push('account_kind_unqualified');
    if (account.metadata?.firebaseUserId !== uid) reasons.push('account_owner_unqualified');
    if (account.country !== 'CA' || !address || address.province !== 'QC') reasons.push('address_unqualified');
    const observedAddressCountry = typeof account.individual?.address?.country === 'string' && account.individual.address.country.trim().toUpperCase() === 'CA';
    if (!observedAddressCountry) reasons.push('address_country_missing_or_invalid');
    if (!dob) reasons.push('provider_dob_missing_or_invalid');
    else if (dob !== evidence.user.dateOfBirth) reasons.push('provider_dob_mismatch');
    if (sourceChanged) reasons.push('authorized_source_changed');
    if (options.invalidateOnly) reasons.push('provider_refresh_required');
    const observed = { schemaVersion: 1, ownerId: uid, accountId: account.id, source: 'stripe_account_observed', residenceVerified: false,
      country: observedAddressCountry ? address?.country ?? null : null, province: address?.province ?? null,
      address: address ? { ...address, country: observedAddressCountry ? address.country : null } : null,
      addressCountryProvenance: observedAddressCountry ? 'individual_address_observed' : 'missing_or_invalid',
      providerDateOfBirth: dob, profileDateOfBirth: declaredDob,
      status: reasons.length ? 'review_required' : 'observed', reasons };
    const identityHash = sha(observed), changed = profile.sellerQuebecEvidence?.identityHash !== identityHash;
    const proof = changed ? { ...observed, identityHash, observedAtMs: Date.now(), observedAt: FieldValue.serverTimestamp(), lastCheckedAtMs: Date.now() }
      : { ...profile.sellerQuebecEvidence, lastCheckedAtMs: Date.now() };
    let nextSignals: Record<string, any> | null = null;
    if (dob && declaredDob && dob !== declaredDob && ageFromIsoDate(dob) !== null) {
      const priorSignals = profile.signals === undefined ? {} : profile.signals;
      if (!priorSignals || typeof priorSignals !== 'object' || Array.isArray(priorSignals)) {
        throw new HttpsError('failed-precondition', 'Les signaux d’examen du compte doivent être régularisés.',
          { reason: 'eligibility_review_required', action: 'contactSupport' });
      }
      const conflict = { schemaVersion: 1, ownerId: uid, accountId: account.id,
        source: 'stripe_account_observed', providerDateOfBirth: dob, profileDateOfBirth: declaredDob };
      // Birth-source identity excludes address, status, observation revision and
      // timestamps: refreshing unchanged evidence never reopens an admin closure.
      const conflictHash = sha(conflict);
      const signals = { ...priorSignals };
      for (const scope of ['buy', 'sell'] as const) {
        const signalId = `signal_connect_dob_${scope}_${conflictHash}`;
        if (Object.prototype.hasOwnProperty.call(signals, signalId)) continue;
        signals[signalId] = { scope, active: true, source: 'stripe_account_dob_conflict',
          evidence: conflict, evidenceHash: conflictHash, actorUid: null, recordedAt: FieldValue.serverTimestamp(),
          internalNote: 'La naissance observée sur le compte Stripe contredit la naissance déclarée. Examinez les sources et les ventes existantes ; ce signal ne décide ni de la naissance ni du sort d’une commande ou de ses fonds.' };
        nextSignals = signals;
      }
    }
    // First valid commit wins among concurrent IO. Even an identical private
    // DOB/address can have different technical flags, so every commit advances.
    const initialBanks = options.operationId && !profile.selectedBank && Array.isArray(account.external_accounts?.data)
      ? account.external_accounts.data.filter((bank: any) => qualifiedCanadianBank(bank, account.id) && bank.default_for_currency === true && bank.last4 === op.bankLast4) : [];
    const initialBank = initialBanks.length === 1 && op.bankDeclaration?.accepted === true ? initialBanks[0] : null;
    const nextProfile: FirebaseFirestore.DocumentData = { ...profile, connectObservationRevision: revision + 1,
      sellerQuebecEvidence: proof, ...(nextSignals ? { signals: nextSignals } : {}),
      ...(changed || nextSignals ? { version: (Number.isSafeInteger(profile.version) ? profile.version : 0) + 1 } : {}),
      ...(options.operationId ? { connectOperation: { ...op, state: 'linked', providerId: account.id, completedAtMs: Date.now() } } : {}),
      ...(initialBank ? { selectedBank: { schemaVersion: 1, source: 'connect_creation_declaration', operationId: op.id,
        accountId: account.id, bankAccountId: initialBank.id, last4: initialBank.last4, status: initialBank.status,
        declared: true, ownershipVerified: false, observedAtMs: Date.now() } } : {}) };
    // The provider observation changes only its own prospective evidence. A
    // spread drops the native reader's ephemeral security capability; carry it
    // to this fresh evaluation clone only when both security sources are the
    // exact unchanged objects qualified by readEligibilityEvidence in THIS tx.
    const admissionProfile = Object.prototype.hasOwnProperty.call(profile,'accountSecurityBarrier') &&
      !hasAccountSecurityBarrier(profile) && nextProfile.accountSecurityBarrier === profile.accountSecurityBarrier &&
      nextProfile.accountSecurityRecovery === profile.accountSecurityRecovery
      ? accountSecurityQualifiedProjection(nextProfile) : nextProfile;
    // All reads precede writes. No DOB setter, signal clearing or public address.
    if (options.transactionGuard) await options.transactionGuard(tx);
    tx.update(userRef, { stripeAccountId: account.id, ...stripeAccountFirestoreFields(state),
      ...(options.operationId ? { stripeAccountCreatedAt: FieldValue.serverTimestamp(), stripeAccountCreationStartedAt: FieldValue.delete() } : {}) });
    tx.set(profileRef, nextProfile);
    return { state, admission: evaluateCurrentSellerEligibility({ ...evidence, user: { ...evidence.user, stripeAccountId: account.id }, profile: admissionProfile }, 'new_paid_shipping'),
      sellerQuebecEvidence: sellerQuebecSummary(proof) };
  });
}

/** Bounded positive lookup only: failure/absence NEVER proves no account exists. */
export async function recoverConnectOperation(uid: string, stripe: StripeClient, privateGuard?: ConnectPrivateGuard) {
  const source = await db.runTransaction(async tx => {
    if (privateGuard) await privateGuard(tx);
    const evidence = await readEligibilityEvidence(tx, uid);
    if (!evidence.user) throw new HttpsError('not-found', 'User not found');
    return { op: evidence.profile?.connectOperation,
      linkedAccountId: evidence.user.stripeAccountId,
      barrier: { ownerId: uid, revision: observationRevision(evidence.profile) } };
  });
  const { op, barrier } = source;
  // Negative outcomes do not enter observe's positive commit. Qualify their
  // source again before publishing absence of a known link or a recovery error.
  // This is read-only: no reset, proof, counter increment or absence inference.
  const assertCurrentNegative = async () => db.runTransaction(async tx => {
    if (privateGuard) await privateGuard(tx);
    const current = await readEligibilityEvidence(tx, uid), currentOp = current.profile?.connectOperation;
    if (!current.user || observationRevision(current.profile) !== barrier.revision ||
        current.user.stripeAccountId !== source.linkedAccountId || validAccountId(current.user.stripeAccountId) ||
        currentOp?.id !== op?.id || currentOp?.state !== op?.state || currentOp?.providerId !== op?.providerId ||
        currentOp?.startedAtMs !== op?.startedAtMs) throw staleObservation();
  });
  if (!op) {
    // A lifetime claim survives loss of the operation/link in a restored DB.
    // It is an opaque unknown receipt, never permission for another create.
    const claim=await readConnectIdentityClaim(uid,'create');
    await assertCurrentNegative();
    if(claim)throw unavailable(claim.reference);
    return null;
  }
  if (validAccountId(op.providerId)) {
    try { if(privateGuard)await privateGuard();const account=await stripe.accounts.retrieve(op.providerId,{expand:['external_accounts']});if(privateGuard)await privateGuard();return {account,operationId:op.id,barrier}; }
    catch (error) {
      if (error instanceof FinancialRecoveryBlocked) throw error; await assertCurrentNegative(); throw error; }
  }
  if (op.state === 'rejected') {
    await assertCurrentNegative();
    throw new HttpsError('failed-precondition', 'La demande a été refusée pour ses paramètres. Le support doit vérifier la correction avant une autre création.',
      { reason: 'connect_creation_rejected', action: 'contactSupport' });
  }
  if (op.state === 'creating' && Number.isSafeInteger(op.startedAtMs) && Date.now() - op.startedAtMs < 2 * 60 * 1000) {
    await assertCurrentNegative();
    throw new HttpsError('aborted', 'La création de votre compte est en cours. Actualisez son statut.',
      { reason: 'connect_creation_in_progress', action: 'getStripeAccountStatus' });
  }
  if (typeof op.id !== 'string' || !op.id) { await assertCurrentNegative(); throw unavailable(); }
  try {
    let cursor: string | undefined; const matches: any[] = [];
    for (let page = 0; page < 3; page++) {
      if(privateGuard)await privateGuard();
      const result = await stripe.accounts.list({ limit: 100, ...(cursor ? { starting_after: cursor } : {}) });
      if(privateGuard)await privateGuard();
      matches.push(...result.data.filter(a => a.metadata?.firebaseUserId === uid && a.metadata?.secondConnectOperationId === op.id));
      if (!result.has_more) break;
      cursor = result.data.at(-1)?.id; if (!cursor) break;
    }
    if (matches.length === 1 && validAccountId(matches[0].id)) return { account: matches[0], operationId: op.id, barrier };
  } catch (recoveryFailure) {
      if (recoveryFailure instanceof FinancialRecoveryBlocked) throw recoveryFailure; /* Preserve unknown, never mint replacement after an infrastructure error. */ }
  await assertCurrentNegative();
  throw unavailable();
}

export async function createOrRecoverConnect(uid: string, data: any, stripe: StripeClient, networkIp: unknown, authEmail: unknown, authToken?: { auth_time?: unknown }, privateGuard?: ConnectPrivateGuard) {
  if(privateGuard)await privateGuard();
  assertExpectedBankActor(uid, data);
  const userRef = db.collection('users').doc(uid), initial = (await userRef.get()).data();
  if (!initial) throw new HttpsError('not-found', 'User not found');
  if (validAccountId(initial.stripeAccountId)) {
    const barrier = await captureConnectObservationBarrier(uid, initial.stripeAccountId,privateGuard);
    if(privateGuard)await privateGuard();
    const account = await stripe.accounts.retrieve(initial.stripeAccountId, { expand: ['external_accounts'] });
    if(privateGuard)await privateGuard();
    return { account, ...await observeConnectAccount(uid, account, { expectedId: initial.stripeAccountId, barrier,transactionGuard:privateGuard }) };
  }
  const recovery = await recoverConnectOperation(uid, stripe,privateGuard);
  if (recovery) return { account: recovery.account, ...await observeConnectAccount(uid, recovery.account, { operationId: recovery.operationId, barrier: recovery.barrier,transactionGuard:privateGuard }) };
  if (initial.stripeAccountId != null || initial.stripeAccountCreationStartedAt != null) throw unavailable();
  assertExpectedBankActor(uid, data, true);
  assertNewPaymentsEnabled();
  const useTestIdentity=data?.useTestIdentity===true;
  if(data?.useTestIdentity!==undefined&&(!useTestIdentity||!isDevCommerceStripeTestRuntime()))throw new HttpsError('invalid-argument',
    'L’identité de test Stripe est réservée à Seconde Dev.',{reason:'dev_identity_not_available'});
  // Only a genuinely new creation needs a current explicit acceptance. Never
  // invent consent for an existing account or an earlier unknown operation.
  const consent = data?.paymentAccountConsent;
  if (!consent || typeof consent !== 'object' || Array.isArray(consent) || consent.accepted !== true) {
    throw new HttpsError('failed-precondition', 'Acceptez les accords Stripe avant de créer votre compte de paiement.',
      { field: 'paymentAccountConsent', reason: 'payment_account_consent_required' });
  }
  if (consent.presentationVersion !== CONNECT_CONSENT_PRESENTATION_VERSION) {
    throw new HttpsError('failed-precondition', 'Actualisez les accords présentés avant de les accepter.',
      { field: 'paymentAccountConsent', reason: 'payment_account_consent_version_required',
        expectedPresentationVersion: CONNECT_CONSENT_PRESENTATION_VERSION });
  }
  // Admission precedes a new DOB payload; no independent initial-DOB setter.
  const authorization = await db.runTransaction(async tx => {
    if (privateGuard) await privateGuard(tx);
    const evidence = await readEligibilityEvidence(tx, uid); await assertOwnPublicationEligibility(evidence, tx, uid); return evidence;
  });
  assertRecentAccountAuthentication(authToken ?? {});
  const bankDeclaration = bankHolderDeclaration(data, authToken!.auth_time);
  const declaredDob = providerDob(data?.dob);
  if (!declaredDob || declaredDob !== authorization.user!.dateOfBirth) throw new HttpsError('invalid-argument', 'La naissance doit correspondre exactement à votre date enregistrée. Une correction passe par le parcours de rectification.');
  const canonicalDob = parseCivilIsoDate(authorization.user!.dateOfBirth)!;
  const address = normalizeCanadianAddress(data?.address ? { street: data.address.line1, city: data.address.city,
    province: data.address.province, postalCode: data.address.postalCode, ...(data.address.country !== undefined ? { country: data.address.country } : {}),
    ...(data.address.line2 !== undefined ? { line2: data.address.line2 } : {}) } : null);
  if (!address) throw new HttpsError('invalid-argument', 'Adresse canadienne complète et cohérente requise.');
  if (address.province !== 'QC') throw new HttpsError('failed-precondition', 'Le nouveau parcours payé avec expédition est réservé aux vendeurs au Québec.');
  if (!['firstName', 'lastName'].every(key => typeof data[key] === 'string' && data[key].trim().length > 0 && data[key].trim().length <= 100) ||
      typeof data.transitNumber !== 'string' || !/^\d{5}$/.test(data.transitNumber) ||
      typeof data.institutionNumber !== 'string' || !/^\d{3}$/.test(data.institutionNumber) ||
      typeof data.accountNumber !== 'string' || !/^\d{7,12}$/.test(data.accountNumber)) throw new HttpsError('invalid-argument', 'Renseignements personnels et bancaires valides requis.');
  if (typeof networkIp !== 'string' || !isIP(networkIp)) throw new HttpsError('invalid-argument', 'Adresse réseau serveur requise pour la demande.');
  const id = randomUUID(), startedAtMs = Date.now();
  const params: StripeCreateParams = { type: 'custom', country: 'CA', business_type: 'individual',
    email: typeof authorization.user!.email === 'string' ? authorization.user!.email : typeof authEmail === 'string' ? authEmail : '',
    individual: { first_name: data.firstName.trim(), last_name: data.lastName.trim(), dob: { year: canonicalDob.year, month: canonicalDob.month, day: canonicalDob.day },
      address: { line1: address.street, city: address.city, state: address.province, postal_code: address.postalCode, country: 'CA', ...(address.line2 ? { line2: address.line2 } : {}) } },
    external_account: { object: 'bank_account', country: 'CA', currency: 'cad', routing_number: data.transitNumber + data.institutionNumber, account_number: data.accountNumber,
      account_holder_name: bankDeclaration.accountHolderName, account_holder_type: 'individual' },
    capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
    business_profile: { product_description: 'Vente de vetements et accessoires de seconde main' },
    settings: { payouts: { schedule: { interval: 'manual' } } }, metadata: { firebaseUserId: uid, secondConnectOperationId: id } };
  if(useTestIdentity){
    // Official provider test tokens only, chosen explicitly in the Dev form.
    // The native DOB remains the member's persisted DOB; no admission flag or
    // provider requirement is fabricated by the application.
    params.individual={...params.individual,email:typeof authEmail==='string'?authEmail:'connect-test@example.invalid',
      phone:'0000000000',relationship:{title:'Owner'},
      verification:{document:{front:'file_identity_document_success'},additional_document:{front:'file_identity_document_success'}}};
    params.business_profile={...params.business_profile,mcc:'5691',url:'https://accessible.stripe.com'};
    params.metadata={...params.metadata,secondeDevTestIdentity:'official_stripe_test_tokens_v1'};
  }
  // Stable across native transaction retries; the lifetime claim binds the
  // actual body without persisting banking, identity or acceptance IP values.
  const acceptedAtMs=Date.now(),tosAcceptance={date:Math.floor(acceptedAtMs/1000),ip:networkIp};
  params.tos_acceptance=tosAcceptance;
  const identityRequestHash=sha(params);
  const creation = await db.runTransaction(async tx => {
    if (privateGuard) await privateGuard(tx);
    const evidence = await readEligibilityEvidence(tx, uid); await assertOwnPublicationEligibility(evidence, tx, uid);
    assertRecentAccountAuthentication(authToken ?? {});
    const revision = observationRevision(evidence.profile);
    if (eligibilityVersion(evidence) !== eligibilityVersion(authorization)) throw new HttpsError('aborted', 'Votre source a changé. Actualisez avant de créer le compte.');
    if (evidence.user?.stripeAccountId || evidence.profile?.connectOperation || evidence.user?.stripeAccountCreationStartedAt) throw new HttpsError('aborted', 'Une création doit déjà être reprise.');
    const consentEvidence = { ownerId: uid, operationId: id, accepted: true,
      presentationVersion: CONNECT_CONSENT_PRESENTATION_VERSION, statement: CONNECT_CONSENT_STATEMENT,
      agreementUrls: CONNECT_CONSENT_AGREEMENT_URLS, translationsUrl: CONNECT_CONSENT_TRANSLATIONS_URL, proofType: 'explicit_checkbox',
      acceptedAt: FieldValue.serverTimestamp(), acceptedAtMs, ip: networkIp, ipSource: 'callable_raw_request' };
    if(privateGuard)await privateGuard(tx);
    const identityClaim=await reserveConnectIdentityClaim(tx,uid,'create',id,identityRequestHash);
    tx.set(db.collection('eligibility_profiles').doc(uid), { ...evidence.profile, connectOperation: { id, state: 'creating', providerId: null,
      startedAtMs, authorizedVersion: eligibilityVersion(evidence), requestHash: sha({ individual: params.individual,
        tos_acceptance: tosAcceptance, metadata: params.metadata, bankLast4: data.accountNumber.slice(-4) }), idempotencyKey: 'connect_account_' + uid,
      bankLast4: data.accountNumber.slice(-4), consent: consentEvidence, bankDeclaration,
      identityClaim:{protocol:identityClaim.protocol,commandId:id,requestHash:identityRequestHash,parentHash:identityClaim.parentHash,epoch:identityClaim.epoch} } });
    tx.update(userRef, { stripeAccountCreationStartedAt: FieldValue.serverTimestamp() });
    return { barrier: { ownerId: uid, revision }, tosAcceptance };
  });
  // Provider attestation derives from the validated, durably recorded server
  // acceptance, never from a client date/IP or account creation alone.
  params.tos_acceptance = creation.tosAcceptance;
  const { barrier } = creation;
  let account: StripeCreatedAccount;
  // Only this fresh native operation may issue the first account create.
  await db.runTransaction(async tx=>{if(privateGuard)await privateGuard(tx);const current=await readEligibilityEvidence(tx,uid);
    const op=current.profile?.connectOperation;
    if(op?.id!==id||op.state!=='creating'||op.providerId||current.user?.stripeAccountId||
      observationRevision(current.profile)!==barrier.revision||eligibilityVersion(current)!==op.authorizedVersion||
      op.identityClaim?.commandId!==id||op.identityClaim?.requestHash!==identityRequestHash)throw unavailable();
    await assertOwnPublicationEligibility(current, tx, uid);if(privateGuard)await privateGuard(tx);
    await assertConnectIdentityPost(uid,'create',id,identityRequestHash);});
  if(privateGuard)await privateGuard();
  try { account = await stripe.accounts.create(params, { idempotencyKey: 'connect_account_' + uid }); }
  catch (error) {
      if (error instanceof FinancialRecoveryBlocked) throw error;
    const e = error as { type?: string; statusCode?: number; code?: string; param?: string };
    const rejected = error instanceof Error && e.type === 'StripeInvalidRequestError' && e.statusCode === 400 &&
      typeof e.param === 'string' && ['parameter_missing', 'parameter_unknown', 'parameter_invalid_integer', 'parameter_invalid_string_blank', 'parameter_invalid_empty'].includes(e.code ?? '');
    await db.runTransaction(async tx => {
    if (privateGuard) await privateGuard(tx);
      const ref = db.collection('eligibility_profiles').doc(uid), profile = (await tx.get(ref)).data();
      if(privateGuard)await privateGuard(tx);
      if (profile?.connectOperation?.id === id && !profile.connectOperation.providerId) tx.update(ref, {
        'connectOperation.state': rejected ? 'rejected' : 'unknown',
        'connectOperation.providerRejection': rejected ? { type: e.type!, code: e.code!, param: e.param!.slice(0, 100), statusCode: 400 } : null });
    });
    if (rejected) throw new HttpsError('failed-precondition', 'La demande a été refusée pour ses paramètres. Aucun compte ne sera déclaré créé.',
      { reason: 'connect_creation_rejected', action: 'contactSupport' });
    throw unavailable();
  }
  if(privateGuard)await privateGuard();
  if (!validAccountId(account?.id)) {
    await db.runTransaction(async tx => {
    if (privateGuard) await privateGuard(tx);
      const ref = db.collection('eligibility_profiles').doc(uid), profile = (await tx.get(ref)).data();
      if(privateGuard)await privateGuard(tx);
      if (profile?.connectOperation?.id === id && !profile.connectOperation.providerId) {
        tx.update(ref, { 'connectOperation.state': 'unknown' });
      }
    });
    throw unavailable();
  }
  // Record the actual ID before linking under current servicing authority. A
  // lost session leaves the durable operation for GET-only recovery, no retry POST.
  await db.runTransaction(async tx => {
    if (privateGuard) await privateGuard(tx);
    const ref = db.collection('eligibility_profiles').doc(uid), profile = (await tx.get(ref)).data();
    if(privateGuard)await privateGuard(tx);
    if (profile?.connectOperation?.id !== id) throw unavailable();
    tx.update(ref, { 'connectOperation.providerId': account.id, 'connectOperation.state': 'created' });
  });
  return { account, ...await observeConnectAccount(uid, account, { operationId: id, barrier,transactionGuard:privateGuard }) };
}
