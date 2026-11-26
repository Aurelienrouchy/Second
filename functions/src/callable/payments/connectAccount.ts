import { FinancialRecoveryBlocked, withFinancialRecoveryScope } from "../../utils/financialRecoveryInterlock";
import {assertPrivateAccountSession, withPrivateAccountSession} from '../../utils/privateAccountSession';
/**
 * Paiement — Compte Stripe Connect Custom du vendeur : création, KYC, compte bancaire, statut.
 *
 * Éclaté depuis functions/src/callable/payments.ts (3881 lignes).
 * `callable/payments.ts` reste la façade : index.ts et sweepPendingLabels
 * importent depuis là, inchangés.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { db } from '../../config/firebase';
import { getStripe } from '../../config/stripe';
import { checkRateLimit, resolveCallerKey } from '../../utils/rateLimit';
import { RATE_LIMIT_WINDOW_MS } from './feeReduction';
import { manageBankAccount, bankOwnerStatus, ownerBankInventory, assertExpectedBankActor, ownerPayoutRestriction } from '../../utils/stripeBank';

import { captureConnectObservationBarrier, createOrRecoverConnect, observeConnectAccount, recoverConnectOperation } from '../../utils/connectEligibility';
import { readConnectCreationReadiness } from '../../utils/connectRecoveryIdentity';

/** Existing accounts are recovered before NEW setup checks. A successful
 * provider setup is separate from admission and any03B3 payment permission. */
export const createStripeConnectAccount = onCall(
  { region: 'northamerica-northeast1', memory: '512MiB', secrets: ['STRIPE_SECRET_KEY'] }, async request => {
    return withFinancialRecoveryScope({operation: "callable/payments/connectAccount.createStripeConnectAccount"}, async () => {
    return withPrivateAccountSession(request,async()=>{
    if (!request.auth) throw new HttpsError('unauthenticated', 'User must be authenticated');
    assertExpectedBankActor(request.auth.uid, request.data);
    const { callerKey, isAuthenticated } = resolveCallerKey(request);
    await checkRateLimit(callerKey, isAuthenticated, { functionName: 'createStripeConnectAccount', maxCallsAuthenticated: 3,
      maxCallsUnauthenticated: 0, windowMs: RATE_LIMIT_WINDOW_MS });
    const stripe = getStripe();
    if (!stripe) throw new HttpsError('failed-precondition', 'Stripe API not configured');
    try {
      const result = await createOrRecoverConnect(request.auth.uid, request.data ?? {}, stripe, request.rawRequest?.ip, request.auth.token.email, request.auth.token,tx=>assertPrivateAccountSession(request,tx));
      const { state, account } = result;
      let bankStatus: Awaited<ReturnType<typeof bankOwnerStatus>>;
      try { bankStatus = await bankOwnerStatus(request.auth.uid, account, stripe,tx=>assertPrivateAccountSession(request,tx)); }
      catch(error) { if(error instanceof FinancialRecoveryBlocked)throw error; if(error instanceof HttpsError)throw error;bankStatus = { bankAccountId: null, bankAccountLast4: null, bankAccountStatus: null, bankDeclarationRequired: true,
        ownershipVerified: false, payoutEligible: false, bankOperation: null, selected: null,
        payoutRestriction: ownerPayoutRestriction(request.auth.uid) }; }
      return { success: true, stripeAccountId: account.id, chargesEnabled: state.chargesEnabled, payoutsEnabled: state.payoutsEnabled,
        detailsSubmitted: state.detailsSubmitted, requirements: state.requirementsCurrentlyDue, status: state.status,
        bankAccountId: bankStatus.bankAccountId, bankAccountLast4: bankStatus.bankAccountLast4, bankAccountStatus: bankStatus.bankAccountStatus,
        bankDeclarationRequired: bankStatus.bankDeclarationRequired, bankOperation: bankStatus.bankOperation,
        payoutEligible: bankStatus.payoutEligible, bankOwnershipVerified: false, payoutRestriction: bankStatus.payoutRestriction,
        admission: result.admission, sellerQuebecEvidence: result.sellerQuebecEvidence };
    } catch (error) { if(error instanceof FinancialRecoveryBlocked)throw error;
      if (error instanceof HttpsError) throw error;
      logger.error('Connect creation/recovery unavailable', { userId: request.auth.uid });
      throw new HttpsError('unavailable', 'Le compte ne peut pas être vérifié actuellement. Aucun compte de remplacement ne sera créé.');
    }
    });

    }).catch((error: unknown) => {
      // Financial controls deliberately fail closed. Translate only their
      // private transport error at the callable boundary, including errors
      // raised before the handler's inner try or by scope finalization. Never
      // turn a refused source into permission to create a replacement account.
      if (!(error instanceof FinancialRecoveryBlocked)) throw error;
      logger.warn('Connect creation blocked by recovery controls', { reason: error.reason });
      throw new HttpsError('unavailable',
        'La configuration du compte de paiement est momentanément indisponible. Réessayez plus tard.',
        { reason: 'connect_service_unavailable', action: 'getStripeAccountStatus' });
    });
  });

export const addBankAccount = onCall(
  { region: 'northamerica-northeast1', memory: '512MiB', secrets: ['STRIPE_SECRET_KEY'] }, async request => {
    return withFinancialRecoveryScope({operation: "callable/payments/connectAccount.addBankAccount"}, async () => {
    return withPrivateAccountSession(request,async()=>{
    if (!request.auth) throw new HttpsError('unauthenticated', 'Authentification requise');
    assertExpectedBankActor(request.auth.uid, request.data);
    const { callerKey, isAuthenticated } = resolveCallerKey(request);
    await checkRateLimit(callerKey, isAuthenticated, { functionName: 'addBankAccount', maxCallsAuthenticated: 5,
      maxCallsUnauthenticated: 0, windowMs: RATE_LIMIT_WINDOW_MS });
    const stripe = getStripe();
    if (!stripe) throw new HttpsError('failed-precondition', 'Le service bancaire est indisponible.');
    try { return await manageBankAccount(request.auth.uid, request.data ?? {}, stripe, request.auth.token,tx=>assertPrivateAccountSession(request,tx)); }
    catch (error) { if(error instanceof FinancialRecoveryBlocked)throw error;
      if (error instanceof HttpsError) throw error;
      // No raw provider message, routing number, holder name or number in logs/DTO.
      logger.error('Bank account operation unavailable', { userId: request.auth.uid });
      throw new HttpsError('unavailable', 'La demande bancaire doit être actualisée. Reprenez la même référence de demande.',
        { reason: 'bank_operation_unknown', action: 'resumeBankOperation', requestId: request.data?.requestId ?? null });
    }
    });

    });
  });

// =============================================================================
// UPLOAD STRIPE IDENTITY DOCUMENT — KYC continuous remediation (white-label)
// =============================================================================

/**
 * F59b — Lets a seller satisfy a Stripe identity-verification requirement
 * entirely in-app (white-label: the seller never visits Stripe). The client
 * sends a base64-encoded image; we create a Stripe `File` with
 * purpose='identity_document', then attach it to the seller's Custom account
 * via individual.verification.document.{front,back}.
 *
 * Auth: the caller must own the Stripe account (its uid carries stripeAccountId).
 * Rate-limited (file uploads hit Stripe + Storage of the document on Stripe's
 * side). Returns the refreshed requirements so the app can update its UI.
 *
 * Input: { frontImageBase64: string, backImageBase64?: string }
 *   - base64 WITHOUT data-URI prefix; JPEG/PNG; capped at ~8 MB decoded.
 */

/**
 * F59b — Lets a seller satisfy a Stripe identity-verification requirement
 * entirely in-app (white-label: the seller never visits Stripe). The client
 * sends a base64-encoded image; we create a Stripe `File` with
 * purpose='identity_document', then attach it to the seller's Custom account
 * via individual.verification.document.{front,back}.
 *
 * Auth: the caller must own the Stripe account (its uid carries stripeAccountId).
 * Rate-limited (file uploads hit Stripe + Storage of the document on Stripe's
 * side). Returns the refreshed requirements so the app can update its UI.
 *
 * Input: { frontImageBase64: string, backImageBase64?: string }
 *   - base64 WITHOUT data-URI prefix; JPEG/PNG; capped at ~8 MB decoded.
 */

export const uploadStripeIdentityDocument = onCall(
  { region: 'northamerica-northeast1', memory: '512MiB', secrets: ['STRIPE_SECRET_KEY'] },
  async (request) => {
    return withFinancialRecoveryScope({operation: "callable/payments/connectAccount.uploadStripeIdentityDocument"}, async () => {
    return withPrivateAccountSession(request, async () => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }
    assertExpectedBankActor(request.auth.uid, request.data, true);

    const { callerKey, isAuthenticated } = resolveCallerKey(request);
    await checkRateLimit(callerKey, isAuthenticated, {
      functionName: 'uploadStripeIdentityDocument',
      maxCallsAuthenticated: 5,
      maxCallsUnauthenticated: 0,
      windowMs: RATE_LIMIT_WINDOW_MS,
    });

    const stripe = getStripe();
    if (!stripe) {
      throw new HttpsError('failed-precondition', 'Stripe API not configured');
    }

    const userId = request.auth.uid;
    const { frontImageBase64, backImageBase64 } = request.data ?? {};

    // ── Input validation ──
    if (typeof frontImageBase64 !== 'string' || frontImageBase64.length < 1) {
      throw new HttpsError('invalid-argument', 'L\'image recto du document est requise');
    }
    if (backImageBase64 !== undefined && typeof backImageBase64 !== 'string') {
      throw new HttpsError('invalid-argument', 'L\'image verso est invalide');
    }

    // ~8 MB decoded cap (base64 is ~4/3 the byte size).
    const MAX_BYTES = 8 * 1024 * 1024;
    const decodeImage = (b64: string, label: string): Buffer => {
      let buf: Buffer;
      try {
        buf = Buffer.from(b64, 'base64');
      } catch {
        throw new HttpsError('invalid-argument', `Image ${label} invalide`);
      }
      if (buf.length < 1) {
        throw new HttpsError('invalid-argument', `Image ${label} vide`);
      }
      if (buf.length > MAX_BYTES) {
        throw new HttpsError('invalid-argument', `Image ${label} trop volumineuse (max 8 Mo)`);
      }
      return buf;
    };

    try {
      const userRef = db.collection('users').doc(userId);
      const userDoc = await userRef.get();
      if (!userDoc.exists) {
        throw new HttpsError('not-found', 'User not found');
      }

      const stripeAccountId = userDoc.data()!.stripeAccountId;
      if (typeof stripeAccountId !== 'string' || !/^acct_[A-Za-z0-9_]{1,190}$/.test(stripeAccountId)) {
        throw new HttpsError(
          'failed-precondition',
          'Aucun compte de paiement trouve. Publiez un article d\'abord.'
        );
      }

      const frontBuffer = decodeImage(frontImageBase64, 'recto');
      // Current servicing authority and the native account/revision are joined
      // before EACH new provider effect. KYC remediation is not new commerce.
      const transactionGuard = (tx: FirebaseFirestore.Transaction) => assertPrivateAccountSession(request, tx);
      const barrier = await captureConnectObservationBarrier(userId, stripeAccountId, transactionGuard);
      const recheckSource = async () => {
        const current = await captureConnectObservationBarrier(userId, stripeAccountId, transactionGuard);
        if (current.revision !== barrier.revision) throw new HttpsError('aborted', 'Les renseignements du compte ont changé. Actualisez son statut.');
      };

      // Create the identity_document File on the connected account.
      const frontFile = await stripe.files.create(
        {
          purpose: 'identity_document',
          file: {
            data: frontBuffer,
            name: 'identity_front.jpg',
            type: 'application/octet-stream',
          },
        },
        { stripeAccount: stripeAccountId }
      );
      await recheckSource();

      let backFileId: string | null = null;
      if (typeof backImageBase64 === 'string' && backImageBase64.length > 0) {
        const backBuffer = decodeImage(backImageBase64, 'verso');
        await recheckSource();
        const backFile = await stripe.files.create(
          {
            purpose: 'identity_document',
            file: {
              data: backBuffer,
              name: 'identity_back.jpg',
              type: 'application/octet-stream',
            },
          },
          { stripeAccount: stripeAccountId }
        );
        await recheckSource();
        backFileId = backFile.id;
      }

      // Attach the document to the individual's verification on the account.
      await recheckSource();
      await stripe.accounts.update(stripeAccountId, {
        individual: {
          verification: {
            document: {
              front: frontFile.id,
              ...(backFileId ? { back: backFileId } : {}),
            },
          },
        },
      });
      await recheckSource();

      // Re-read under the same causal/owner fence as the status callable.
      const account = await stripe.accounts.retrieve(stripeAccountId, {
        expand: ['external_accounts'],
      });
      await assertPrivateAccountSession(request);
      const observed = await observeConnectAccount(userId, account, { expectedId: stripeAccountId, barrier, transactionGuard });
      const committed = await captureConnectObservationBarrier(userId, stripeAccountId, transactionGuard);
      if (committed.revision !== barrier.revision + 1) throw new HttpsError('aborted', 'Le statut du compte a changé. Actualisez-le.');
      const state = observed.state;

      logger.info('Stripe identity document uploaded', {
        userId,
        stripeAccountId,
        hasBack: backFileId !== null,
        requirementsCurrentlyDue: state.requirementsCurrentlyDue,
        status: state.status,
      });

      return {
        success: true,
        status: state.status,
        chargesEnabled: state.chargesEnabled,
        payoutsEnabled: state.payoutsEnabled,
        requirementsCurrentlyDue: state.requirementsCurrentlyDue,
        requirementsPastDue: state.requirementsPastDue,
        verificationErrors: state.verificationErrors,
        requirementsPendingVerification: state.requirementsPendingVerification,
        disabledReason: state.disabledReason,
      };
    } catch (error: unknown) { if(error instanceof FinancialRecoveryBlocked)throw error;
      if (error instanceof HttpsError) throw error;
      logger.error('Error uploading Stripe identity document', { userId });
      throw new HttpsError('internal', 'Le document ne peut pas être envoyé actuellement. Actualisez le statut du compte avant de réessayer.');
    }
    });

    });
  }
);

// =============================================================================
// GET STRIPE ACCOUNT STATUS — Check if seller's Connect account is active
// =============================================================================

/**
 * Retrieves the current status of the seller's Stripe Connect account
 * (charges_enabled, payouts_enabled, details_submitted) and updates
 * the status in Firestore.
 */

/**
 * Retrieves the current status of the seller's Stripe Connect account
 * (charges_enabled, payouts_enabled, details_submitted) and updates
 * the status in Firestore.
 */

export const getStripeAccountStatus = onCall(
  { region: 'northamerica-northeast1', memory: '512MiB', secrets: ['STRIPE_SECRET_KEY'] },
  async (request) => {
    return withFinancialRecoveryScope({operation: "callable/payments/connectAccount.getStripeAccountStatus"}, async () => {
  return withPrivateAccountSession(request, async () => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const stripe = getStripe();
    if (!stripe) {
      throw new HttpsError('failed-precondition', 'Stripe API not configured');
    }

    const userId = request.auth.uid;

    try {
      const userRef = db.collection('users').doc(userId);
      const userDoc = await userRef.get();

      if (!userDoc.exists) {
        throw new HttpsError('not-found', 'User not found');
      }

      const userData = userDoc.data()!;
      let stripeAccountId = userData.stripeAccountId;
      let recovered: Awaited<ReturnType<typeof recoverConnectOperation>> = null;
      if (!stripeAccountId) {
        try { recovered = await recoverConnectOperation(userId, stripe,tx=>assertPrivateAccountSession(request,tx)); stripeAccountId = recovered?.account.id ?? null; }
        catch (error) { if(error instanceof FinancialRecoveryBlocked)throw error;
          if (!(error instanceof HttpsError)) throw error;
          const reason = (error.details as { reason?: string } | null)?.reason;
          const recoveryReference=(error.details as {recoveryReference?:unknown}|null)?.recoveryReference;
          // Only explicit, still-current recovery states become a neutral DTO.
          // Causal conflicts and failed source reads must remain errors.
          if (!((error.code === 'aborted' && reason === 'connect_creation_in_progress') ||
                (error.code === 'failed-precondition' && reason === 'connect_creation_rejected') ||
                (error.code === 'unavailable' && reason === 'connect_creation_unknown'))) throw error;
          return { success: true, hasAccount: false, chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: false,
            status: 'none', requirementsCurrentlyDue: [], requirementsPastDue: [], verificationErrors: [], requirementsPendingVerification: [],
            disabledReason: null, currentDeadline: null,
            bankAccountLast4: null, connectActionRequired: true,
            ...(reason==='connect_creation_unknown'&&typeof recoveryReference==='string'&&/^[a-f0-9]{64}$/.test(recoveryReference)?{recoveryReference}:{}),
            connectOperationState: reason === 'connect_creation_in_progress' ? 'creating' : reason === 'connect_creation_rejected' ? 'rejected' : 'unknown' };
        }
      }

      if (!stripeAccountId) {
        const connectCreationReady = await readConnectCreationReadiness(userId, tx=>assertPrivateAccountSession(request,tx));
        return {
          success: true,
          hasAccount: false,
          chargesEnabled: false,
          payoutsEnabled: false,
          detailsSubmitted: false,
          status: 'none',
          requirementsCurrentlyDue: [],
          requirementsPastDue: [],
          verificationErrors: [],
          requirementsPendingVerification: [],
          disabledReason: null,
          currentDeadline: null,
          bankAccountLast4: null,
          bankAccountId: null, bankAccountStatus: null, bankDeclarationRequired: true,
          bankOperation: null, payoutEligible: false, bankOwnershipVerified: false, payoutRestriction: ownerPayoutRestriction(userId),
          connectActionRequired: !!userData.stripeAccountCreationStartedAt,
          // Qualified read-only observation. A new explicit submission still
          // needs current authentication, consent and all creation guards.
          connectCreationReady,
          ...(request.data?.includeBankAccounts === true ? {bankAccountsAvailable: true, bankAccounts: [], bankChangesBlockedReason: null} : {}),
        };
      }

      // Retrieve the account from Stripe (expand external accounts so we can
      // surface the default bank account last4 + verification status, F60b).
      const barrier = recovered?.barrier ?? await captureConnectObservationBarrier(userId, stripeAccountId,tx=>assertPrivateAccountSession(request,tx));
      const account = recovered?.account ?? await stripe.accounts.retrieve(stripeAccountId, {
        expand: ['external_accounts'],
      });

      const observed = await observeConnectAccount(userId, account, recovered ?
        { operationId: recovered.operationId, barrier, transactionGuard:tx=>assertPrivateAccountSession(request,tx) } : { expectedId: stripeAccountId, barrier, transactionGuard:tx=>assertPrivateAccountSession(request,tx) });
      const state = observed.state;
      let bankStatus: Awaited<ReturnType<typeof bankOwnerStatus>>;
      try { bankStatus = await bankOwnerStatus(userId, account, stripe,tx=>assertPrivateAccountSession(request,tx)); }
      catch(error) { if(error instanceof FinancialRecoveryBlocked)throw error; if(error instanceof HttpsError)throw error;bankStatus = { bankAccountId: null, bankAccountLast4: null, bankAccountStatus: null, bankDeclarationRequired: true,
        ownershipVerified: false, payoutEligible: false, bankOperation: null, selected: null,
        payoutRestriction: ownerPayoutRestriction(userId) }; }

      // Inventory is opt-in for account management. Checkout, wallet and KYC
      // polling keep their existing lightweight status contract.
      let inventory: Awaited<ReturnType<typeof ownerBankInventory>> | {bankAccountsAvailable: false; bankAccounts: []} | null = null;
      if (request.data?.includeBankAccounts === true) {
        try { inventory = await ownerBankInventory(userId, account, stripe, tx=>assertPrivateAccountSession(request,tx)); }
        catch (error) {
          if (error instanceof FinancialRecoveryBlocked) throw error;
          await assertPrivateAccountSession(request);
          inventory = {bankAccountsAvailable: false, bankAccounts: []};
          logger.warn('Bank inventory unavailable', {userId});
        }
      }

      // Persist the canonical state — requirements + bank status included
      // (F59a/F60b), all CF-only & never undefined.


      logger.info('Stripe account status checked', {
        userId,
        stripeAccountId,
        status: state.status,
        chargesEnabled: state.chargesEnabled,
        payoutsEnabled: state.payoutsEnabled,
        requirementsCurrentlyDue: state.requirementsCurrentlyDue,
        disabledReason: state.disabledReason,
      });

      // Full contract consumed by the app (wallet ↔ onboarding loop, F62/F117).
      return {
        success: true,
        hasAccount: true,
        chargesEnabled: state.chargesEnabled,
        payoutsEnabled: state.payoutsEnabled,
        detailsSubmitted: state.detailsSubmitted,
        status: state.status,
        requirementsCurrentlyDue: state.requirementsCurrentlyDue,
        requirementsPastDue: state.requirementsPastDue,
        verificationErrors: state.verificationErrors,
        requirementsPendingVerification: state.requirementsPendingVerification,
        disabledReason: state.disabledReason,
        currentDeadline: state.currentDeadline,
        bankAccountLast4: bankStatus.bankAccountLast4,
        bankAccountId: bankStatus.bankAccountId, bankAccountStatus: bankStatus.bankAccountStatus,
        bankDeclarationRequired: bankStatus.bankDeclarationRequired, bankOperation: bankStatus.bankOperation,
        payoutEligible: bankStatus.payoutEligible, bankOwnershipVerified: false, payoutRestriction: bankStatus.payoutRestriction,
        admission: observed.admission, sellerQuebecEvidence: observed.sellerQuebecEvidence, connectActionRequired: false,
        ...(inventory ?? {}),
      };
    } catch (error: unknown) { if(error instanceof FinancialRecoveryBlocked)throw error;
      if (error instanceof HttpsError) throw error;
      logger.error('Error checking Stripe account status', { userId });
      throw new HttpsError('internal', 'Le statut du compte ne peut pas être vérifié actuellement. Réessayez après actualisation.');
    }

  });

    }).catch((error: unknown) => {
      if (!(error instanceof FinancialRecoveryBlocked)) throw error;
      logger.warn('Connect status blocked by recovery controls', { reason: error.reason });
      throw new HttpsError('unavailable',
        'Le statut du compte de paiement est momentanément indisponible. Réessayez plus tard.',
        { reason: 'connect_service_unavailable', action: 'getStripeAccountStatus' });
    });
  }
);

// =============================================================================
// FIND PICKUP POINTS — ShipEngine PUDO search
// =============================================================================
