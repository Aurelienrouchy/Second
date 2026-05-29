/**
 * Unit tests for wallet callable functions
 *
 * Mocks Firestore, Stripe, and firebase-functions to test
 * activateWallet, getWalletInfo, walletWithdraw, payWithWallet
 * in isolation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// vi.hoisted — variables referenced inside vi.mock factories must live here
// because vi.mock calls are hoisted to the top of the file by vitest.
// ---------------------------------------------------------------------------

interface WriteOp {
  method: 'set' | 'update';
  path: string;
  data: Record<string, unknown>;
}

const {
  writeOps,
  docSnapshots,
  queryResults,
  autoDocCounter,
  mockDb,
  mockFieldValue,
  mockStripeTransfersCreate,
  mockStripePayoutsCreate,
  mockSnap: _mockSnap,
  mockDocRef: _mockDocRef,
  mockCollectionRef,
  createMockTransaction,
  setDoc,
  setQuery,
} = vi.hoisted(() => {
  // Mutable state containers
  const state = {
    writeOps: [] as WriteOp[],
    docSnapshots: {} as Record<
      string,
      { exists: boolean; data: () => Record<string, unknown> | undefined; id: string }
    >,
    queryResults: {} as Record<
      string,
      Array<{ id: string; data: () => Record<string, unknown> }>
    >,
    autoDocCounter: { value: 0 },
  };

  function mockSnap(
    path: string,
    data: Record<string, unknown> | null
  ): { exists: boolean; data: () => Record<string, unknown> | undefined; id: string } {
    return {
      exists: data !== null,
      data: () => (data !== null ? data : undefined),
      id: path.split('/').pop()!,
    };
  }

  function setDoc(path: string, data: Record<string, unknown> | null) {
    state.docSnapshots[path] = mockSnap(path, data);
  }

  function setQuery(path: string, docs: Array<{ id: string; data: Record<string, unknown> }>) {
    state.queryResults[path] = docs.map((d) => ({ id: d.id, data: () => d.data }));
  }

  function mockDocRef(path: string): Record<string, unknown> {
    return {
      path,
      get: async () => state.docSnapshots[path] ?? mockSnap(path, null),
      set: async (data: Record<string, unknown>) => {
        state.writeOps.push({ method: 'set', path, data });
      },
      update: async (data: Record<string, unknown>) => {
        state.writeOps.push({ method: 'update', path, data });
      },
      collection: (sub: string) => mockCollectionRef(`${path}/${sub}`),
    };
  }

  function mockCollectionRef(path: string): Record<string, unknown> {
    // Chainable query stub: supports any sequence of where/orderBy/limit
    // terminated by get(). Results come from state.queryResults[path]
    // (default empty — e.g. the walletWithdraw dispute guard finds no
    // disputed transactions unless a test explicitly seeds them).
    const makeQuery = (): Record<string, unknown> => {
      const q: Record<string, unknown> = {
        where: () => makeQuery(),
        orderBy: () => makeQuery(),
        limit: () => makeQuery(),
        startAfter: () => makeQuery(),
        get: async () => {
          const docs = state.queryResults[path] ?? [];
          return { docs, empty: docs.length === 0, size: docs.length };
        },
      };
      return q;
    };

    return {
      path,
      doc: (id?: string) => {
        const docId = id ?? `auto_${++state.autoDocCounter.value}`;
        return mockDocRef(`${path}/${docId}`);
      },
      where: () => makeQuery(),
      orderBy: () => makeQuery(),
      limit: () => makeQuery(),
    };
  }

  function createMockTransaction() {
    return {
      get: async (ref: { path: string }) =>
        state.docSnapshots[ref.path] ?? mockSnap(ref.path, null),
      set: (ref: { path: string }, data: Record<string, unknown>) => {
        state.writeOps.push({ method: 'set', path: ref.path, data });
      },
      update: (ref: { path: string }, data: Record<string, unknown>) => {
        state.writeOps.push({ method: 'update', path: ref.path, data });
      },
    };
  }

  const mockDb = {
    collection: (name: string) => mockCollectionRef(name),
    runTransaction: async (fn: (tx: ReturnType<typeof createMockTransaction>) => Promise<unknown>) => {
      const tx = createMockTransaction();
      return fn(tx);
    },
  };

  const mockFieldValue = {
    serverTimestamp: () => ({ _type: 'serverTimestamp' }),
    increment: (n: number) => ({ _type: 'increment', value: n }),
    arrayUnion: (...args: unknown[]) => ({ _type: 'arrayUnion', values: args }),
  };

  const mockStripeTransfersCreate = { fn: null as unknown };
  const mockStripePayoutsCreate = { fn: null as unknown };

  return {
    writeOps: state.writeOps,
    docSnapshots: state.docSnapshots,
    queryResults: state.queryResults,
    autoDocCounter: state.autoDocCounter,
    mockDb,
    mockFieldValue,
    mockStripeTransfersCreate,
    mockStripePayoutsCreate,
    mockSnap,
    mockDocRef,
    mockCollectionRef,
    createMockTransaction,
    setDoc,
    setQuery,
  };
});

// ---------------------------------------------------------------------------
// vi.mock — these are hoisted above imports by vitest
// ---------------------------------------------------------------------------

vi.mock('../config/firebase', () => ({
  db: mockDb,
  FieldValue: mockFieldValue,
}));

vi.mock('../config/stripe', () => ({
  getStripe: () => ({
    transfers: {
      create: (...args: unknown[]) =>
        (mockStripeTransfersCreate.fn as (...a: unknown[]) => unknown)(...args),
    },
    payouts: {
      create: (...args: unknown[]) =>
        (mockStripePayoutsCreate.fn as (...a: unknown[]) => unknown)(...args),
    },
  }),
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
    onCall: (_opts: unknown, handler: (...args: unknown[]) => unknown) => handler,
    HttpsError: _HttpsError,
  };
});

// ---------------------------------------------------------------------------
// Import the module under test
// ---------------------------------------------------------------------------
import { activateWallet, getWalletInfo, walletWithdraw, payWithWallet } from './wallet';

// Because of our onCall mock, the exports are the raw handler functions
type CallableHandler = (request: {
  auth?: { uid: string } | null;
  data?: Record<string, unknown>;
}) => Promise<Record<string, unknown>>;

const callActivateWallet = activateWallet as unknown as CallableHandler;
const callGetWalletInfo = getWalletInfo as unknown as CallableHandler;
const callWalletWithdraw = walletWithdraw as unknown as CallableHandler;
const callPayWithWallet = payWithWallet as unknown as CallableHandler;

// ---------------------------------------------------------------------------
// Reset state before each test
// ---------------------------------------------------------------------------
beforeEach(() => {
  // Clear mutable state
  writeOps.length = 0;
  for (const key of Object.keys(docSnapshots)) delete docSnapshots[key];
  for (const key of Object.keys(queryResults)) delete queryResults[key];
  autoDocCounter.value = 0;

  // Reset mockDb methods to use fresh closures over cleared state
  mockDb.collection = (name: string) => mockCollectionRef(name);
  mockDb.runTransaction = async (
    fn: (tx: ReturnType<typeof createMockTransaction>) => Promise<unknown>
  ) => {
    const tx = createMockTransaction();
    return fn(tx);
  };

  // Default Stripe mocks
  mockStripeTransfersCreate.fn = async () => ({ id: 'tr_123' });
  mockStripePayoutsCreate.fn = async () => ({ id: 'po_123' });
});

// ===========================================================================
// activateWallet
// ===========================================================================

describe('activateWallet', () => {
  it('requires authentication', async () => {
    await expect(callActivateWallet({ auth: null })).rejects.toThrow(
      'User must be authenticated'
    );
    await expect(callActivateWallet({ auth: null })).rejects.toMatchObject({
      code: 'unauthenticated',
    });
  });

  it('creates wallet doc when none exists', async () => {
    const result = await callActivateWallet({ auth: { uid: 'user1' } });

    expect(result.success).toBe(true);
    expect(result.balance).toBe(0);
    expect(result.pendingBalance).toBe(0);
    expect(result.status).toBe('active');

    const walletWrite = writeOps.find(
      (w) => w.path === 'wallets/user1' && w.method === 'set'
    );
    expect(walletWrite).toBeDefined();
    expect(walletWrite!.data.balance).toBe(0);
    expect(walletWrite!.data.pendingBalance).toBe(0);
    expect(walletWrite!.data.currency).toBe('cad');
    expect(walletWrite!.data.status).toBe('active');
  });

  it('returns existing wallet if already active (idempotent)', async () => {
    setDoc('wallets/user1', {
      balance: 5000,
      pendingBalance: 1000,
      status: 'active',
      currency: 'cad',
    });

    const result = await callActivateWallet({ auth: { uid: 'user1' } });

    expect(result.success).toBe(true);
    expect(result.balance).toBe(5000);
    expect(result.pendingBalance).toBe(1000);
    expect(result.status).toBe('active');

    // No set write should have occurred
    const walletSet = writeOps.find(
      (w) => w.path === 'wallets/user1' && w.method === 'set'
    );
    expect(walletSet).toBeUndefined();
  });

  it('sets correct initial wallet fields including timestamps', async () => {
    await callActivateWallet({ auth: { uid: 'newuser' } });

    const walletWrite = writeOps.find(
      (w) => w.path === 'wallets/newuser' && w.method === 'set'
    );
    expect(walletWrite).toBeDefined();
    expect(walletWrite!.data).toMatchObject({
      balance: 0,
      pendingBalance: 0,
      currency: 'cad',
      status: 'active',
    });
    expect(walletWrite!.data.activatedAt).toBeDefined();
    expect(walletWrite!.data.updatedAt).toBeDefined();
  });
});

// ===========================================================================
// getWalletInfo
// ===========================================================================

describe('getWalletInfo', () => {
  it('requires authentication', async () => {
    await expect(callGetWalletInfo({ auth: null })).rejects.toThrow(
      'User must be authenticated'
    );
    await expect(callGetWalletInfo({ auth: null })).rejects.toMatchObject({
      code: 'unauthenticated',
    });
  });

  it('returns hasWallet: false when no wallet exists', async () => {
    const result = await callGetWalletInfo({ auth: { uid: 'user1' } });
    expect(result).toEqual({ hasWallet: false });
  });

  it('returns correct balance and ledger entries when wallet exists', async () => {
    // getWalletInfo serializes date fields via `?.toDate?.()?.toISOString()`
    // (wallet.ts ~209,219). Firestore returns Timestamp objects with a toDate()
    // method, so the fixtures must mimic that shape — a raw string has no
    // toDate() and would serialize to null.
    setDoc('wallets/user1', {
      balance: 12000,
      pendingBalance: 3000,
      currency: 'cad',
      status: 'active',
      activatedAt: { toDate: () => new Date('2026-01-01T00:00:00Z') },
    });

    setQuery('wallets/user1/ledger', [
      {
        id: 'ledger1',
        data: {
          type: 'purchase_debit',
          amount: 5000,
          balanceAfter: 12000,
          description: 'Achat article',
          transactionId: 'tx1',
          createdAt: { toDate: () => new Date('2026-05-01T00:00:00Z') },
        },
      },
      {
        id: 'ledger2',
        data: {
          type: 'sale_credit',
          amount: 8000,
          balanceAfter: 17000,
          description: 'Vente article',
          createdAt: { toDate: () => new Date('2026-04-28T00:00:00Z') },
        },
      },
    ]);

    const result = await callGetWalletInfo({ auth: { uid: 'user1' } });

    expect(result.hasWallet).toBe(true);
    expect(result.balance).toBe(12000);
    expect(result.pendingBalance).toBe(3000);
    expect(result.currency).toBe('cad');
    expect(result.status).toBe('active');
    expect(result.activatedAt).toBe('2026-01-01T00:00:00.000Z');

    const ledger = result.ledger as Array<Record<string, unknown>>;
    expect(ledger).toHaveLength(2);
    expect(ledger[0].id).toBe('ledger1');
    expect(ledger[0].type).toBe('purchase_debit');
    expect(ledger[0].transactionId).toBe('tx1');
    expect(ledger[0].createdAt).toBe('2026-05-01T00:00:00.000Z');
    expect(ledger[1].id).toBe('ledger2');
    expect(ledger[1].transactionId).toBeNull(); // missing field => null fallback
  });
});

// ===========================================================================
// walletWithdraw
// ===========================================================================

describe('walletWithdraw', () => {
  function setupWithdrawable(balance = 5000) {
    setDoc('users/user1', {
      stripeAccountId: 'acct_123',
      stripeChargesEnabled: true,
      // Required by the payouts-enabled guard in wallet.ts (added by a prior
      // chantier); without it every withdrawal test throws failed-precondition.
      stripePayoutsEnabled: true,
      stripeBankAccountLast4: '4242',
    });
    setDoc('wallets/user1', {
      balance,
      pendingBalance: 0,
      status: 'active',
      currency: 'cad',
    });
  }

  it('requires authentication', async () => {
    await expect(
      callWalletWithdraw({ auth: null, data: { amount: 1000 } })
    ).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('rejects non-integer amounts', async () => {
    setupWithdrawable();
    await expect(
      callWalletWithdraw({ auth: { uid: 'user1' }, data: { amount: 10.5 } })
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('rejects zero amount', async () => {
    setupWithdrawable();
    await expect(
      callWalletWithdraw({ auth: { uid: 'user1' }, data: { amount: 0 } })
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('rejects negative amount', async () => {
    setupWithdrawable();
    await expect(
      callWalletWithdraw({ auth: { uid: 'user1' }, data: { amount: -500 } })
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('rejects if amount < 1000 (min $10)', async () => {
    setupWithdrawable();
    await expect(
      callWalletWithdraw({ auth: { uid: 'user1' }, data: { amount: 999 } })
    ).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(
      callWalletWithdraw({ auth: { uid: 'user1' }, data: { amount: 999 } })
    ).rejects.toThrow('retrait minimum');
  });

  it('rejects if user has no stripeAccountId', async () => {
    setDoc('users/user1', { stripeChargesEnabled: true });
    setDoc('wallets/user1', { balance: 5000, status: 'active' });

    await expect(
      callWalletWithdraw({ auth: { uid: 'user1' }, data: { amount: 1000 } })
    ).rejects.toMatchObject({ code: 'failed-precondition' });
    await expect(
      callWalletWithdraw({ auth: { uid: 'user1' }, data: { amount: 1000 } })
    ).rejects.toThrow('compte de paiement');
  });

  it('rejects if stripeChargesEnabled is false', async () => {
    setDoc('users/user1', {
      stripeAccountId: 'acct_123',
      stripeChargesEnabled: false,
    });
    setDoc('wallets/user1', { balance: 5000, status: 'active' });

    await expect(
      callWalletWithdraw({ auth: { uid: 'user1' }, data: { amount: 1000 } })
    ).rejects.toMatchObject({ code: 'failed-precondition' });
    await expect(
      callWalletWithdraw({ auth: { uid: 'user1' }, data: { amount: 1000 } })
    ).rejects.toThrow('pas encore actif');
  });

  it('rejects if no wallet exists', async () => {
    setDoc('users/user1', {
      stripeAccountId: 'acct_123',
      stripeChargesEnabled: true,
      // Required by the payouts-enabled guard (wallet.ts ~300) — without it the
      // function throws failed-precondition BEFORE reaching the not-found check
      // this test targets.
      stripePayoutsEnabled: true,
    });

    await expect(
      callWalletWithdraw({ auth: { uid: 'user1' }, data: { amount: 1000 } })
    ).rejects.toMatchObject({ code: 'not-found' });
    await expect(
      callWalletWithdraw({ auth: { uid: 'user1' }, data: { amount: 1000 } })
    ).rejects.toThrow('porte-monnaie');
  });

  it('rejects if amount > balance', async () => {
    setupWithdrawable(2000);

    await expect(
      callWalletWithdraw({ auth: { uid: 'user1' }, data: { amount: 3000 } })
    ).rejects.toMatchObject({ code: 'failed-precondition' });
    await expect(
      callWalletWithdraw({ auth: { uid: 'user1' }, data: { amount: 3000 } })
    ).rejects.toThrow('Solde insuffisant');
  });

  it('correctly debits wallet balance and creates ledger entry', async () => {
    setupWithdrawable(5000);

    const result = await callWalletWithdraw({
      auth: { uid: 'user1' },
      data: { amount: 2000 },
    });

    expect(result.success).toBe(true);
    expect(result.newBalance).toBe(3000);
    expect(result.transferId).toBe('tr_123');
    expect(result.payoutId).toBe('po_123');

    // Wallet was debited
    const walletUpdate = writeOps.find(
      (w) => w.path === 'wallets/user1' && w.method === 'update'
    );
    expect(walletUpdate).toBeDefined();

    // Ledger entry was created
    const ledgerSet = writeOps.find(
      (w) => w.path.startsWith('wallets/user1/ledger/') && w.method === 'set'
    );
    expect(ledgerSet).toBeDefined();
    expect(ledgerSet!.data.type).toBe('withdrawal');
    expect(ledgerSet!.data.amount).toBe(2000);
    expect(ledgerSet!.data.balanceAfter).toBe(3000);
  });

  it('accepts exact minimum amount of 1000', async () => {
    setupWithdrawable(1000);

    const result = await callWalletWithdraw({
      auth: { uid: 'user1' },
      data: { amount: 1000 },
    });

    expect(result.success).toBe(true);
    expect(result.newBalance).toBe(0);
  });

  it('calls Stripe transfers.create and payouts.create with correct params', async () => {
    setupWithdrawable(5000);

    let transferArgs: unknown[] = [];
    let payoutArgs: unknown[] = [];
    mockStripeTransfersCreate.fn = async (...args: unknown[]) => {
      transferArgs = args;
      return { id: 'tr_456' };
    };
    mockStripePayoutsCreate.fn = async (...args: unknown[]) => {
      payoutArgs = args;
      return { id: 'po_456' };
    };

    const result = await callWalletWithdraw({
      auth: { uid: 'user1' },
      data: { amount: 2000 },
    });

    expect(result.transferId).toBe('tr_456');
    expect(result.payoutId).toBe('po_456');

    expect(transferArgs[0]).toEqual({
      amount: 2000,
      currency: 'cad',
      destination: 'acct_123',
      metadata: {
        firebaseUserId: 'user1',
        walletWithdrawal: 'true',
      },
    });
    // Deterministic idempotency key derived from the ledger entry id
    expect(transferArgs[1]).toEqual({ idempotencyKey: expect.stringMatching(/^tr_/) });

    expect(payoutArgs[0]).toEqual({
      amount: 2000,
      currency: 'cad',
      metadata: {
        firebaseUserId: 'user1',
        walletWithdrawal: 'true',
      },
    });
    // stripe-node v22: single RequestOptions object carries both the Connect
    // account selection and the deterministic idempotency key.
    expect(payoutArgs[1]).toEqual({
      stripeAccount: 'acct_123',
      idempotencyKey: expect.stringMatching(/^po_/),
    });
  });

  it('reverts wallet debit when Stripe transfer fails', async () => {
    setupWithdrawable(5000);

    // Track runTransaction call count
    let txCallCount = 0;
    const origRunTransaction = mockDb.runTransaction;
    mockDb.runTransaction = async (fn: (tx: ReturnType<typeof createMockTransaction>) => Promise<unknown>) => {
      txCallCount++;
      const tx = createMockTransaction();
      return fn(tx);
    };

    mockStripeTransfersCreate.fn = async () => {
      throw new Error('Stripe network error');
    };

    await expect(
      callWalletWithdraw({ auth: { uid: 'user1' }, data: { amount: 2000 } })
    ).rejects.toThrow('Stripe network error');

    // Three runTransaction calls: rate-limit check + debit + revert.
    // (transfers.create throws BEFORE `transfer` is assigned, so no
    // transfers.createReversal happens — that is a Stripe call, not a
    // runTransaction, anyway.)
    expect(txCallCount).toBe(3);

    // Revert should update the wallet again
    const walletUpdates = writeOps.filter(
      (w) => w.path === 'wallets/user1' && w.method === 'update'
    );
    expect(walletUpdates.length).toBeGreaterThanOrEqual(2);

    // Restore
    mockDb.runTransaction = origRunTransaction;
  });

  it('reverts wallet debit when Stripe payout fails', async () => {
    setupWithdrawable(5000);

    let txCallCount = 0;
    mockDb.runTransaction = async (fn: (tx: ReturnType<typeof createMockTransaction>) => Promise<unknown>) => {
      txCallCount++;
      const tx = createMockTransaction();
      return fn(tx);
    };

    mockStripePayoutsCreate.fn = async () => {
      throw new Error('Payout failed');
    };

    await expect(
      callWalletWithdraw({ auth: { uid: 'user1' }, data: { amount: 2000 } })
    ).rejects.toThrow('Payout failed');

    // Three runTransaction calls: rate-limit check + debit + revert. The
    // transfer succeeded so the code ALSO calls stripe.transfers.createReversal,
    // but that is a Stripe call (mocked), not a runTransaction.
    expect(txCallCount).toBe(3);
  });

  it('rejects string amounts', async () => {
    setupWithdrawable();
    await expect(
      callWalletWithdraw({ auth: { uid: 'user1' }, data: { amount: '1000' } })
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('rejects when data is undefined', async () => {
    setupWithdrawable();
    await expect(
      callWalletWithdraw({ auth: { uid: 'user1' }, data: undefined })
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('handles inactive wallet', async () => {
    setDoc('users/user1', {
      stripeAccountId: 'acct_123',
      stripeChargesEnabled: true,
      // Required by the payouts-enabled guard so we reach the wallet-status check.
      stripePayoutsEnabled: true,
    });
    setDoc('wallets/user1', { balance: 5000, pendingBalance: 0, status: 'suspended' });

    await expect(
      callWalletWithdraw({ auth: { uid: 'user1' }, data: { amount: 1000 } })
    ).rejects.toMatchObject({ code: 'failed-precondition' });
    await expect(
      callWalletWithdraw({ auth: { uid: 'user1' }, data: { amount: 1000 } })
    ).rejects.toThrow('pas actif');
  });

  it('works at exact balance', async () => {
    setDoc('users/user1', {
      stripeAccountId: 'acct_123',
      stripeChargesEnabled: true,
      // Required by the payouts-enabled guard for a withdrawal that must SUCCEED.
      stripePayoutsEnabled: true,
      stripeBankAccountLast4: '9876',
    });
    setDoc('wallets/user1', { balance: 1000, pendingBalance: 0, status: 'active' });

    const result = await callWalletWithdraw({
      auth: { uid: 'user1' },
      data: { amount: 1000 },
    });

    expect(result.success).toBe(true);
    expect(result.newBalance).toBe(0);
  });
});

// ===========================================================================
// payWithWallet
// ===========================================================================

describe('payWithWallet', () => {
  function setupPayable(opts?: {
    buyerBalance?: number;
    totalAmount?: number;
    sellerPayout?: number;
    sellerId?: string;
    status?: string;
    sellerHasWallet?: boolean;
    articleId?: string;
  }) {
    const {
      buyerBalance = 10000,
      totalAmount = 50,
      sellerPayout = 45,
      sellerId = 'seller1',
      status = 'pending_payment',
      sellerHasWallet = true,
      articleId = 'article1',
    } = opts ?? {};

    setDoc('transactions/tx1', {
      buyerId: 'buyer1',
      sellerId,
      status,
      totalAmount,
      sellerPayout,
      amount: sellerPayout,
      articleId,
      chatId: 'chat1',
    });

    setDoc('wallets/buyer1', {
      balance: buyerBalance,
      pendingBalance: 0,
      status: 'active',
      currency: 'cad',
    });

    if (sellerHasWallet) {
      setDoc(`wallets/${sellerId}`, {
        balance: 2000,
        pendingBalance: 0,
        status: 'active',
        currency: 'cad',
      });
    }
  }

  it('requires authentication', async () => {
    await expect(
      callPayWithWallet({ auth: null, data: { transactionId: 'tx1' } })
    ).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('rejects if transactionId is missing', async () => {
    await expect(
      callPayWithWallet({ auth: { uid: 'buyer1' }, data: {} })
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('rejects if transactionId is empty string', async () => {
    await expect(
      callPayWithWallet({ auth: { uid: 'buyer1' }, data: { transactionId: '' } })
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('rejects if transactionId is non-string type', async () => {
    await expect(
      callPayWithWallet({ auth: { uid: 'buyer1' }, data: { transactionId: 12345 } })
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('rejects if transaction does not exist', async () => {
    setDoc('wallets/buyer1', { balance: 10000, status: 'active' });

    await expect(
      callPayWithWallet({
        auth: { uid: 'buyer1' },
        data: { transactionId: 'tx_nonexistent' },
      })
    ).rejects.toMatchObject({ code: 'not-found' });
  });

  it('rejects if caller is not the buyer', async () => {
    setupPayable();

    await expect(
      callPayWithWallet({ auth: { uid: 'intruder' }, data: { transactionId: 'tx1' } })
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('rejects if transaction not in pending_payment status', async () => {
    setupPayable({ status: 'paid' });

    await expect(
      callPayWithWallet({ auth: { uid: 'buyer1' }, data: { transactionId: 'tx1' } })
    ).rejects.toThrow('Cannot pay for transaction in status paid');
  });

  it('rejects various non-payable statuses', async () => {
    for (const status of ['cancelled', 'delivered', 'refunded', 'shipped']) {
      // Clear state for each iteration
      writeOps.length = 0;
      for (const key of Object.keys(docSnapshots)) delete docSnapshots[key];

      setupPayable({ status });

      await expect(
        callPayWithWallet({ auth: { uid: 'buyer1' }, data: { transactionId: 'tx1' } })
      ).rejects.toThrow(`Cannot pay for transaction in status ${status}`);
    }
  });

  it('rejects if buyer has no wallet', async () => {
    setDoc('transactions/tx1', {
      buyerId: 'buyer1',
      sellerId: 'seller1',
      status: 'pending_payment',
      totalAmount: 50,
      sellerPayout: 45,
      articleId: 'article1',
    });

    await expect(
      callPayWithWallet({ auth: { uid: 'buyer1' }, data: { transactionId: 'tx1' } })
    ).rejects.toMatchObject({ code: 'failed-precondition' });
    await expect(
      callPayWithWallet({ auth: { uid: 'buyer1' }, data: { transactionId: 'tx1' } })
    ).rejects.toThrow('porte-monnaie');
  });

  it('rejects if buyer wallet balance < total amount', async () => {
    setupPayable({ buyerBalance: 4999, totalAmount: 50 });

    await expect(
      callPayWithWallet({ auth: { uid: 'buyer1' }, data: { transactionId: 'tx1' } })
    ).rejects.toMatchObject({ code: 'failed-precondition' });
    await expect(
      callPayWithWallet({ auth: { uid: 'buyer1' }, data: { transactionId: 'tx1' } })
    ).rejects.toThrow('Solde insuffisant');
  });

  it('correctly debits buyer wallet', async () => {
    setupPayable({ buyerBalance: 10000, totalAmount: 50 });

    const result = await callPayWithWallet({
      auth: { uid: 'buyer1' },
      data: { transactionId: 'tx1' },
    });

    expect(result.success).toBe(true);
    expect(result.newBalance).toBe(5000); // 10000 - 5000

    const buyerWalletUpdate = writeOps.find(
      (w) => w.path === 'wallets/buyer1' && w.method === 'update'
    );
    expect(buyerWalletUpdate).toBeDefined();
  });

  it('correctly credits seller pendingBalance when seller has wallet', async () => {
    setupPayable({ sellerHasWallet: true, sellerPayout: 45 });

    await callPayWithWallet({
      auth: { uid: 'buyer1' },
      data: { transactionId: 'tx1' },
    });

    const sellerWalletUpdate = writeOps.find(
      (w) => w.path === 'wallets/seller1' && w.method === 'update'
    );
    expect(sellerWalletUpdate).toBeDefined();
  });

  it('marks transaction as paid with paidVia wallet', async () => {
    setupPayable();

    await callPayWithWallet({
      auth: { uid: 'buyer1' },
      data: { transactionId: 'tx1' },
    });

    // For a non-shipping sale the transaction is written TWICE inside the same
    // runTransaction: first by creditSellerForSale ({ sellerCreditedCents }),
    // then the status update ({ status, paidAt, paidVia, walletAmountUsed }).
    // Target the write that carries the status field, not the first match.
    const txUpdate = writeOps.find(
      (w) =>
        w.path === 'transactions/tx1' &&
        w.method === 'update' &&
        w.data.status === 'paid'
    );
    expect(txUpdate).toBeDefined();
    expect(txUpdate!.data.status).toBe('paid');
    expect(txUpdate!.data.paidVia).toBe('wallet');
  });

  it('marks article as isSold: true', async () => {
    setupPayable({ articleId: 'article1' });

    await callPayWithWallet({
      auth: { uid: 'buyer1' },
      data: { transactionId: 'tx1' },
    });

    const articleUpdate = writeOps.find(
      (w) => w.path === 'articles/article1' && w.method === 'update'
    );
    expect(articleUpdate).toBeDefined();
    expect(articleUpdate!.data.isSold).toBe(true);
  });

  it('creates ledger entry for buyer with correct type and balanceAfter', async () => {
    setupPayable({ buyerBalance: 8000, totalAmount: 30 });

    await callPayWithWallet({
      auth: { uid: 'buyer1' },
      data: { transactionId: 'tx1' },
    });

    const ledgerEntry = writeOps.find(
      (w) => w.path.startsWith('wallets/buyer1/ledger/') && w.method === 'set'
    );
    expect(ledgerEntry).toBeDefined();
    expect(ledgerEntry!.data.type).toBe('purchase_debit');
    expect(ledgerEntry!.data.amount).toBe(3000);
    expect(ledgerEntry!.data.balanceAfter).toBe(5000);
    expect(ledgerEntry!.data.transactionId).toBe('tx1');
  });

  it('credits seller pendingBalance even when seller has no prior wallet', async () => {
    // NEW behavior (P1 atomic credit): for a non-shipping sale, payWithWallet
    // calls creditSellerForSale -> getOrCreateSellerWallet, which CREATES the
    // seller wallet on the fly and credits pendingBalance immediately. The old
    // "skip credit if no wallet" behavior is gone — the seller must be paid.
    setupPayable({ sellerHasWallet: false, totalAmount: 50, sellerPayout: 45 });

    const result = await callPayWithWallet({
      auth: { uid: 'buyer1' },
      data: { transactionId: 'tx1' },
    });

    expect(result.success).toBe(true);

    // The wallet is created (set) ...
    const sellerWalletCreate = writeOps.find(
      (w) => w.path === 'wallets/seller1' && w.method === 'set'
    );
    expect(sellerWalletCreate).toBeDefined();

    // ... and credited (update) with the sellerPayout in CENTS (45$ -> 4500).
    const sellerWalletCredit = writeOps.find(
      (w) =>
        w.path === 'wallets/seller1' &&
        w.method === 'update' &&
        w.data.pendingBalance !== undefined
    );
    expect(sellerWalletCredit).toBeDefined();
    expect(sellerWalletCredit!.data.pendingBalance).toBe(4500);
  });

  it('handles exact balance match (balance === totalAmount in cents)', async () => {
    setupPayable({ buyerBalance: 5000, totalAmount: 50 });

    const result = await callPayWithWallet({
      auth: { uid: 'buyer1' },
      data: { transactionId: 'tx1' },
    });

    expect(result.success).toBe(true);
    expect(result.newBalance).toBe(0);
  });

  it('rejects zero balance wallet trying to pay', async () => {
    setupPayable({ buyerBalance: 0, totalAmount: 50 });

    await expect(
      callPayWithWallet({ auth: { uid: 'buyer1' }, data: { transactionId: 'tx1' } })
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('stores walletAmountUsed on transaction', async () => {
    setupPayable({ totalAmount: 25 });

    await callPayWithWallet({
      auth: { uid: 'buyer1' },
      data: { transactionId: 'tx1' },
    });

    // Two updates to transactions/tx1 (creditSellerForSale + status update);
    // walletAmountUsed lives on the status update, in CENTS (25$ -> 2500).
    const txUpdate = writeOps.find(
      (w) =>
        w.path === 'transactions/tx1' &&
        w.method === 'update' &&
        w.data.walletAmountUsed !== undefined
    );
    expect(txUpdate).toBeDefined();
    expect(txUpdate!.data.walletAmountUsed).toBe(2500);
  });

  it('handles inactive buyer wallet', async () => {
    setDoc('transactions/tx1', {
      buyerId: 'buyer1',
      sellerId: 'seller1',
      status: 'pending_payment',
      totalAmount: 10,
      sellerPayout: 9,
      articleId: 'a1',
    });
    setDoc('wallets/buyer1', { balance: 5000, pendingBalance: 0, status: 'suspended' });

    await expect(
      callPayWithWallet({ auth: { uid: 'buyer1' }, data: { transactionId: 'tx1' } })
    ).rejects.toMatchObject({ code: 'failed-precondition' });
    await expect(
      callPayWithWallet({ auth: { uid: 'buyer1' }, data: { transactionId: 'tx1' } })
    ).rejects.toThrow('pas actif');
  });

  it('rejects transaction with zero totalAmount', async () => {
    setDoc('transactions/tx1', {
      buyerId: 'buyer1',
      sellerId: 'seller1',
      status: 'pending_payment',
      totalAmount: 0,
      sellerPayout: 0,
      articleId: 'a1',
    });
    setDoc('wallets/buyer1', { balance: 5000, pendingBalance: 0, status: 'active' });

    await expect(
      callPayWithWallet({ auth: { uid: 'buyer1' }, data: { transactionId: 'tx1' } })
    ).rejects.toMatchObject({ code: 'failed-precondition' });
    await expect(
      callPayWithWallet({ auth: { uid: 'buyer1' }, data: { transactionId: 'tx1' } })
    ).rejects.toThrow('Transaction amount is invalid');
  });
});

// ===========================================================================
// Cross-cutting: atomicity
// ===========================================================================

describe('atomicity guarantees', () => {
  it('activateWallet uses runTransaction', async () => {
    let txCalled = false;
    mockDb.runTransaction = async (fn: (tx: ReturnType<typeof createMockTransaction>) => Promise<unknown>) => {
      txCalled = true;
      const tx = createMockTransaction();
      return fn(tx);
    };

    await callActivateWallet({ auth: { uid: 'user1' } });
    expect(txCalled).toBe(true);
  });

  it('payWithWallet uses runTransaction for all mutations', async () => {
    let txCalled = false;
    mockDb.runTransaction = async (fn: (tx: ReturnType<typeof createMockTransaction>) => Promise<unknown>) => {
      txCalled = true;
      const tx = createMockTransaction();
      return fn(tx);
    };

    setDoc('transactions/tx1', {
      buyerId: 'buyer1',
      sellerId: 'seller1',
      status: 'pending_payment',
      totalAmount: 10,
      sellerPayout: 9,
      articleId: 'a1',
    });
    setDoc('wallets/buyer1', { balance: 5000, pendingBalance: 0, status: 'active' });
    setDoc('wallets/seller1', { balance: 0, pendingBalance: 0, status: 'active' });

    await callPayWithWallet({
      auth: { uid: 'buyer1' },
      data: { transactionId: 'tx1' },
    });

    expect(txCalled).toBe(true);
  });

  it('walletWithdraw uses runTransaction for debit', async () => {
    let txCalled = false;
    mockDb.runTransaction = async (fn: (tx: ReturnType<typeof createMockTransaction>) => Promise<unknown>) => {
      txCalled = true;
      const tx = createMockTransaction();
      return fn(tx);
    };

    setDoc('users/user1', {
      stripeAccountId: 'acct_123',
      stripeChargesEnabled: true,
      // Required by the payouts-enabled guard for a withdrawal that must SUCCEED.
      stripePayoutsEnabled: true,
      stripeBankAccountLast4: '4242',
    });
    setDoc('wallets/user1', { balance: 5000, pendingBalance: 0, status: 'active' });

    await callWalletWithdraw({
      auth: { uid: 'user1' },
      data: { amount: 1000 },
    });

    expect(txCalled).toBe(true);
  });
});
