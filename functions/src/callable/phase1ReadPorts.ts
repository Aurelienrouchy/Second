/** Published phase-one readers. No payment/provider recovery or command is
 * reachable through these exports; ordinary Dev TEST retains its own names. */
import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {auth, db} from '../config/firebase';
import {readFinancialRecoveryControl, withFinancialRecoveryIoBudget} from '../config/recoveryControl';
import {isPaymentsEnabled, isShippingEnabled} from '../config/featureFlags';
import {requireRuntimeProjectId} from '../config/runtimeEnvironment';
import {assertPrivateAccountSession, withPrivateAccountSession} from '../utils/privateAccountSession';
import {assertRecentAccountAuthentication} from '../utils/eligibility';
import {supportAdmin} from '../utils/supportRequest';
import {readFraudReview} from '../utils/fraudReviewReader';

const unavailable = (): never => {throw new HttpsError('failed-precondition',
  'Le statut de paiement de ce compte nécessite une vérification.', {reason: 'phase1_payment_status_unqualified'});};
function financialMarker(value: unknown, depth = 0): boolean {
  if (!value || typeof value !== 'object') return false;
  if (depth > 16) return true;
  if (Array.isArray(value)) return value.some(item => financialMarker(item, depth + 1));
  if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  return Object.entries(value).some(([key, item]) =>
    /stripe|bank|wallet|ledger|payout|financial|connect|payment|providerSubmission|withdrawal/i.test(key)
    || financialMarker(item, depth + 1));
}
function phase1Cutoff(): number {
  const value = process.env.SECONDE_PHASE1_NEW_ACCOUNT_CUTOFF, cutoff = Date.parse(value ?? '');
  if (!value || !Number.isSafeInteger(cutoff) || cutoff <= 0 || cutoff > Date.now()
      || new Date(cutoff).toISOString() !== value || process.env.FINANCIAL_RECOVERY_ENVIRONMENT !== 'unconfigured'
      || isPaymentsEnabled() || isShippingEnabled()) return unavailable();
  requireRuntimeProjectId();
  return cutoff;
}

/** The immutable release cutoff qualifies ONLY newly created native Auth
 * identities. A missing Firestore provider marker never qualifies older ones. */
export async function readPhase1StripeAccountStatus(request: any) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Connexion requise.');
  const raw = request.data ?? {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)
      || Object.keys(raw).some(key => !['expectedUid', 'includeBankAccounts'].includes(key))
      || Object.prototype.hasOwnProperty.call(raw, 'includeBankAccounts') && typeof raw.includeBankAccounts !== 'boolean') {
    throw new HttpsError('invalid-argument', 'Paramètres de lecture invalides.');
  }
  return withFinancialRecoveryIoBudget(() => withPrivateAccountSession(request, async () => {
    const cutoff = phase1Cutoff(), q = await readFinancialRecoveryControl();
    if (q.control.mode !== 'normal' || q.control.financialEnvironment !== 'unconfigured' || q.control.previousEpoch !== null) return unavailable();
    const source = await auth.getUser(request.auth.uid), birth = Date.parse(source.metadata.creationTime);
    if (source.uid !== request.auth.uid || source.disabled !== false || !Number.isSafeInteger(birth)
        || birth <= cutoff || birth > Date.now()) return unavailable();
    const result = await db.runTransaction(async tx => {
      await assertPrivateAccountSession(request, tx);
      const [user, profile, wallet] = await Promise.all([
        tx.get(db.collection('users').doc(source.uid)), tx.get(db.collection('eligibility_profiles').doc(source.uid)),
        tx.get(db.collection('wallets').doc(source.uid)),
      ]);
      if (!user.exists || financialMarker(user.data()) || financialMarker(profile.data()) || wallet.exists) return unavailable();
      return {success: true, hasAccount: false, chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: false,
        status: 'none', requirementsCurrentlyDue: [], requirementsPastDue: [], verificationErrors: [], requirementsPendingVerification: [],
        disabledReason: null, currentDeadline: null, bankAccountLast4: null, bankAccountId: null, bankAccountStatus: null,
        bankDeclarationRequired: true, bankOperation: null, payoutEligible: false, bankOwnershipVerified: false,
        connectActionRequired: false, connectCreationReady: false,
        ...(raw.includeBankAccounts === true ? {bankAccountsAvailable: true, bankAccounts: [], bankChangesBlockedReason: null} : {})};
    });
    const [after, native] = await Promise.all([readFinancialRecoveryControl(), auth.getUser(source.uid)]);
    if (after.generation !== q.generation || after.sha256 !== q.sha256 || after.control.mode !== 'normal'
        || native.uid !== source.uid || native.disabled !== false || native.metadata.creationTime !== source.metadata.creationTime) return unavailable();
    return result;
  }));
}

const fraudModes = new Set(['fraud_admin_cases_observe', 'fraud_admin_case_observe']);
async function currentFraudAdministrator(request: any): Promise<void> {
  assertRecentAccountAuthentication(request.auth?.token ?? {});
  const provider = request.auth?.token?.firebase?.sign_in_provider;
  if (!['password', 'google.com', 'apple.com'].includes(provider)) {
    throw new HttpsError('unauthenticated', 'Confirmez votre identité avant de poursuivre.');
  }
  await db.runTransaction(async tx => {
    const session = await assertPrivateAccountSession(request, tx);
    await supportAdmin(tx, session.uid, session.currentAdminClaim);
  });
}
/** Existing fraud projections are native reads. This deliberately excludes
 * transport queries, seller activity, decisions and every financial command. */
export async function readPhase1TrackingStatus(request: any) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Connexion requise.');
  if (request.data?.expectedUid !== request.auth.uid) throw new HttpsError('permission-denied', 'La session a changé.');
  if (!fraudModes.has(request.data?.mode)) throw new HttpsError('failed-precondition',
    'Cette lecture ne fait pas partie de la phase actuelle.', {reason: 'phase1_read_mode_unavailable'});
  await currentFraudAdministrator(request);
  const result = await readFraudReview(request);
  await currentFraudAdministrator(request);
  return result;
}

export const getStripeAccountStatusPhase1 = onCall({region: 'northamerica-northeast1', memory: '512MiB'}, readPhase1StripeAccountStatus);
export const checkTrackingStatusPhase1 = onCall({region: 'northamerica-northeast1', memory: '512MiB'}, readPhase1TrackingStatus);
