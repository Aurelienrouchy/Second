/**
 * Tests for the Stripe Connect Custom account lifecycle callables (Vague 6a):
 *   - getStripeAccountStatus  : F62/F117 full status contract + requirements persist
 *   - uploadStripeIdentityDocument : F59b KYC continuous remediation
 *   - addBankAccount          : F60a replacement (default_for_currency)
 *
 * These drive the REAL exported onCall handlers through a mocked Stripe + an
 * in-memory Firestore. Only the I/O boundaries are mocked.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFirestoreMock, createStripeMock } from '../utils/testHelpers/firestoreMock';
import type { MockFirestore } from '../utils/testHelpers/firestoreMock';

const holder = vi.hoisted(() => ({
  fs: null as MockFirestore | null,
  stripe: null as ReturnType<typeof import('../utils/testHelpers/firestoreMock').createStripeMock> | null,
}));

const fs: MockFirestore = createFirestoreMock();
const stripeMock = createStripeMock();
holder.fs = fs;
holder.stripe = stripeMock;

vi.mock('../config/firebase', () => ({
  get db() {
    return holder.fs!.db;
  },
  get FieldValue() {
    return holder.fs!.FieldValue;
  },
}));

vi.mock('../config/stripe', () => ({
  getStripe: () => holder.stripe!.client,
}));

vi.mock('../config/shipEngine', () => ({
  getShipEngine: () => ({}),
}));

vi.mock('../utils/fees', () => ({
  calculateFees: () => ({}),
  calculateServiceFee: () => 0,
  getServiceFeeConfig: () => ({}),
}));

vi.mock('../utils/rateLimit', () => ({
  checkRateLimit: async () => {},
  resolveCallerKey: (request: { auth?: { uid?: string } }) => ({
    callerKey: request.auth?.uid ?? 'anon',
    isAuthenticated: !!request.auth,
  }),
}));

vi.mock('../utils/trackingTransition', () => ({
  applyTrackingOutcome: () => {},
  DELIVERABLE_STATUSES: new Set<string>(),
}));

vi.mock('../utils/notifications', () => ({
  sendPushNotification: async () => {},
}));

vi.mock('../utils/refund', () => ({
  issueTransactionRefund: async () => ({ success: true }),
}));

vi.mock('firebase-functions/logger', () => ({
  info: () => {},
  error: () => {},
  warn: () => {},
  debug: () => {},
}));

vi.mock('firebase-functions/v2/https', () => {
  class _HttpsError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
      this.name = 'HttpsError';
    }
  }
  return {
    onCall: (_opts: unknown, handler: unknown) => handler,
    HttpsError: _HttpsError,
  };
});

import {
  getStripeAccountStatus,
  uploadStripeIdentityDocument,
  addBankAccount,
} from './payments';

type CallableHandler = (request: {
  auth?: { uid: string } | null;
  data?: Record<string, unknown>;
}) => Promise<Record<string, unknown>>;

const callStatus = getStripeAccountStatus as unknown as CallableHandler;
const callUpload = uploadStripeIdentityDocument as unknown as CallableHandler;
const callAddBank = addBankAccount as unknown as CallableHandler;

beforeEach(() => {
  fs.reset();
  stripeMock.reset();
  process.env.STRIPE_SECRET_KEY = 'sk_test';
});

// ---------------------------------------------------------------------------
// getStripeAccountStatus — full contract (F62/F117)
// ---------------------------------------------------------------------------

describe('getStripeAccountStatus — full status contract (F62/F117)', () => {
  it('requires authentication', async () => {
    await expect(callStatus({ auth: null, data: {} })).rejects.toMatchObject({
      code: 'unauthenticated',
    });
  });

  it('returns the complete requirements + bank contract and persists it', async () => {
    fs.setDoc('users/seller1', { stripeAccountId: 'acct_1' });
    stripeMock.impl.accountsRetrieve = async () => ({
      id: 'acct_1',
      charges_enabled: true,
      payouts_enabled: false,
      details_submitted: true,
      requirements: {
        currently_due: ['individual.verification.document'],
        past_due: ['individual.verification.document'],
        disabled_reason: 'requirements.past_due',
        current_deadline: 1234567890,
      },
      external_accounts: {
        data: [{ id: 'ba_1', last4: '4321', status: 'verified', default_for_currency: true }],
      },
    });

    const res = await callStatus({ auth: { uid: 'seller1' }, data: {} });

    // Full contract surfaced to the app.
    expect(res.status).toBe('restricted');
    expect(res.chargesEnabled).toBe(true);
    expect(res.payoutsEnabled).toBe(false);
    expect(res.detailsSubmitted).toBe(true);
    expect(res.requirementsCurrentlyDue).toEqual(['individual.verification.document']);
    expect(res.requirementsPastDue).toEqual(['individual.verification.document']);
    expect(res.disabledReason).toBe('requirements.past_due');
    expect(res.currentDeadline).toBe(1234567890);
    expect(res.bankAccountLast4).toBe('4321');

    // Persisted on the user doc (CF-only fields).
    const u = fs.getDoc('users/seller1')!;
    expect(u.stripeAccountStatus).toBe('restricted');
    expect(u.stripeRequirementsCurrentlyDue).toEqual(['individual.verification.document']);
    expect(u.stripeRequirementsDisabledReason).toBe('requirements.past_due');
    expect(u.stripeBankAccountLast4).toBe('4321');
    expect(u.stripeBankAccountStatus).toBe('verified');
  });

  it('returns the no-account contract when stripeAccountId is absent', async () => {
    fs.setDoc('users/seller_none', {});
    const res = await callStatus({ auth: { uid: 'seller_none' }, data: {} });
    expect(res.hasAccount).toBe(false);
    expect(res.requirementsCurrentlyDue).toEqual([]);
    expect(res.disabledReason).toBe(null);
    expect(res.bankAccountLast4).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// uploadStripeIdentityDocument — F59b
// ---------------------------------------------------------------------------

describe('uploadStripeIdentityDocument — KYC remediation (F59b)', () => {
  const frontB64 = Buffer.from('front-image-bytes').toString('base64');
  const backB64 = Buffer.from('back-image-bytes').toString('base64');

  it('requires authentication', async () => {
    await expect(
      callUpload({ auth: null, data: { frontImageBase64: frontB64 } })
    ).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('rejects when the front image is missing', async () => {
    fs.setDoc('users/seller1', { stripeAccountId: 'acct_1' });
    await expect(
      callUpload({ auth: { uid: 'seller1' }, data: {} })
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('rejects when the seller has no Stripe account', async () => {
    fs.setDoc('users/seller_noacct', {});
    await expect(
      callUpload({ auth: { uid: 'seller_noacct' }, data: { frontImageBase64: frontB64 } })
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('creates a Stripe File and attaches it to the account, returning fresh requirements', async () => {
    fs.setDoc('users/seller1', {
      stripeAccountId: 'acct_1',
      stripeRequirementsCurrentlyDue: ['individual.verification.document'],
    });
    stripeMock.impl.filesCreate = async () => ({ id: 'file_front_1' });
    stripeMock.impl.accountsRetrieve = async () => ({
      id: 'acct_1',
      charges_enabled: true,
      payouts_enabled: true,
      details_submitted: true,
      requirements: { currently_due: [], past_due: [], disabled_reason: null },
      external_accounts: { data: [] },
    });

    const res = await callUpload({
      auth: { uid: 'seller1' },
      data: { frontImageBase64: frontB64, backImageBase64: backB64 },
    });

    // Two files created (front + back), attached via accounts.update.
    expect(stripeMock.calls.filesCreate.length).toBe(2);
    expect(stripeMock.calls.accountsUpdate.length).toBe(1);
    const updateArg = stripeMock.calls.accountsUpdate[0][1] as any;
    expect(updateArg.individual.verification.document.front).toBe('file_front_1');
    expect(updateArg.individual.verification.document.back).toBe('file_front_1');

    // Fresh requirements returned + persisted.
    expect(res.status).toBe('active');
    expect(res.requirementsCurrentlyDue).toEqual([]);
    expect(fs.getDoc('users/seller1')!.stripeRequirementsCurrentlyDue).toEqual([]);
  });

  it('uploads front only when no back image is provided', async () => {
    fs.setDoc('users/seller1', { stripeAccountId: 'acct_1' });
    const res = await callUpload({
      auth: { uid: 'seller1' },
      data: { frontImageBase64: frontB64 },
    });
    expect(stripeMock.calls.filesCreate.length).toBe(1);
    const updateArg = stripeMock.calls.accountsUpdate[0][1] as any;
    expect(updateArg.individual.verification.document.back).toBeUndefined();
    expect(res.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// addBankAccount — F60a replacement (default_for_currency)
// ---------------------------------------------------------------------------

describe('addBankAccount — replacement support (F60a)', () => {
  const validBank = {
    transitNumber: '12345',
    institutionNumber: '003',
    accountNumber: '1234567',
  };

  it('requires authentication', async () => {
    await expect(callAddBank({ auth: null, data: validBank })).rejects.toMatchObject({
      code: 'unauthenticated',
    });
  });

  it('sets the new account as default_for_currency and persists last4 + status', async () => {
    fs.setDoc('users/seller1', { stripeAccountId: 'acct_1', stripeBankAccountLast4: '0000' });
    stripeMock.impl.accountsCreateExternalAccount = async () => ({
      id: 'ba_new',
      last4: '4567',
      status: 'new',
    });
    stripeMock.impl.accountsListExternalAccounts = async () => ({
      data: [{ id: 'ba_old' }, { id: 'ba_new' }],
    });

    const res = await callAddBank({ auth: { uid: 'seller1' }, data: validBank });

    // New external account created with default_for_currency: true.
    const createArg = stripeMock.calls.accountsCreateExternalAccount[0][1] as any;
    expect(createArg.default_for_currency).toBe(true);

    // Old (non-default) external account pruned, new one kept.
    expect(stripeMock.calls.accountsDeleteExternalAccount.length).toBe(1);
    expect(stripeMock.calls.accountsDeleteExternalAccount[0][1]).toBe('ba_old');

    // last4 + status returned + persisted.
    expect(res.bankAccountLast4).toBe('4567');
    expect(res.bankAccountStatus).toBe('new');
    const u = fs.getDoc('users/seller1')!;
    expect(u.stripeBankAccountAdded).toBe(true);
    expect(u.stripeBankAccountLast4).toBe('4567');
    expect(u.stripeBankAccountStatus).toBe('new');
  });

  it('rejects an invalid transit number', async () => {
    fs.setDoc('users/seller1', { stripeAccountId: 'acct_1' });
    await expect(
      callAddBank({ auth: { uid: 'seller1' }, data: { ...validBank, transitNumber: '12' } })
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });
});
