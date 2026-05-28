"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Unit tests for wallet callable functions
 *
 * Mocks Firestore, Stripe, and firebase-functions to test
 * activateWallet, getWalletInfo, walletWithdraw, payWithWallet
 * in isolation.
 */
const vitest_1 = require("vitest");
const { writeOps, docSnapshots, queryResults, autoDocCounter, mockDb, mockFieldValue, mockStripeTransfersCreate, mockStripePayoutsCreate, mockSnap: _mockSnap, mockDocRef: _mockDocRef, mockCollectionRef, createMockTransaction, setDoc, setQuery, } = vitest_1.vi.hoisted(() => {
    // Mutable state containers
    const state = {
        writeOps: [],
        docSnapshots: {},
        queryResults: {},
        autoDocCounter: { value: 0 },
    };
    function mockSnap(path, data) {
        return {
            exists: data !== null,
            data: () => (data !== null ? data : undefined),
            id: path.split('/').pop(),
        };
    }
    function setDoc(path, data) {
        state.docSnapshots[path] = mockSnap(path, data);
    }
    function setQuery(path, docs) {
        state.queryResults[path] = docs.map((d) => ({ id: d.id, data: () => d.data }));
    }
    function mockDocRef(path) {
        return {
            path,
            get: async () => { var _a; return (_a = state.docSnapshots[path]) !== null && _a !== void 0 ? _a : mockSnap(path, null); },
            set: async (data) => {
                state.writeOps.push({ method: 'set', path, data });
            },
            update: async (data) => {
                state.writeOps.push({ method: 'update', path, data });
            },
            collection: (sub) => mockCollectionRef(`${path}/${sub}`),
        };
    }
    function mockCollectionRef(path) {
        return {
            path,
            doc: (id) => {
                const docId = id !== null && id !== void 0 ? id : `auto_${++state.autoDocCounter.value}`;
                return mockDocRef(`${path}/${docId}`);
            },
            orderBy: () => ({
                limit: () => ({
                    get: async () => {
                        var _a;
                        return ({
                            docs: (_a = state.queryResults[path]) !== null && _a !== void 0 ? _a : [],
                        });
                    },
                }),
            }),
        };
    }
    function createMockTransaction() {
        return {
            get: async (ref) => { var _a; return (_a = state.docSnapshots[ref.path]) !== null && _a !== void 0 ? _a : mockSnap(ref.path, null); },
            set: (ref, data) => {
                state.writeOps.push({ method: 'set', path: ref.path, data });
            },
            update: (ref, data) => {
                state.writeOps.push({ method: 'update', path: ref.path, data });
            },
        };
    }
    const mockDb = {
        collection: (name) => mockCollectionRef(name),
        runTransaction: async (fn) => {
            const tx = createMockTransaction();
            return fn(tx);
        },
    };
    const mockFieldValue = {
        serverTimestamp: () => ({ _type: 'serverTimestamp' }),
        increment: (n) => ({ _type: 'increment', value: n }),
        arrayUnion: (...args) => ({ _type: 'arrayUnion', values: args }),
    };
    const mockStripeTransfersCreate = { fn: null };
    const mockStripePayoutsCreate = { fn: null };
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
vitest_1.vi.mock('../config/firebase', () => ({
    db: mockDb,
    FieldValue: mockFieldValue,
}));
vitest_1.vi.mock('../config/stripe', () => ({
    getStripe: () => ({
        transfers: {
            create: (...args) => mockStripeTransfersCreate.fn(...args),
        },
        payouts: {
            create: (...args) => mockStripePayoutsCreate.fn(...args),
        },
    }),
}));
vitest_1.vi.mock('firebase-functions/logger', () => ({
    info: () => { },
    error: () => { },
    warn: () => { },
    debug: () => { },
}));
vitest_1.vi.mock('firebase-functions/v2/https', () => {
    class _HttpsError extends Error {
        constructor(code, message) {
            super(message);
            this.code = code;
            this.name = 'HttpsError';
        }
    }
    return {
        onCall: (_opts, handler) => handler,
        HttpsError: _HttpsError,
    };
});
// ---------------------------------------------------------------------------
// Import the module under test
// ---------------------------------------------------------------------------
const wallet_1 = require("./wallet");
const callActivateWallet = wallet_1.activateWallet;
const callGetWalletInfo = wallet_1.getWalletInfo;
const callWalletWithdraw = wallet_1.walletWithdraw;
const callPayWithWallet = wallet_1.payWithWallet;
// ---------------------------------------------------------------------------
// Reset state before each test
// ---------------------------------------------------------------------------
(0, vitest_1.beforeEach)(() => {
    // Clear mutable state
    writeOps.length = 0;
    for (const key of Object.keys(docSnapshots))
        delete docSnapshots[key];
    for (const key of Object.keys(queryResults))
        delete queryResults[key];
    autoDocCounter.value = 0;
    // Reset mockDb methods to use fresh closures over cleared state
    mockDb.collection = (name) => mockCollectionRef(name);
    mockDb.runTransaction = async (fn) => {
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
(0, vitest_1.describe)('activateWallet', () => {
    (0, vitest_1.it)('requires authentication', async () => {
        await (0, vitest_1.expect)(callActivateWallet({ auth: null })).rejects.toThrow('User must be authenticated');
        await (0, vitest_1.expect)(callActivateWallet({ auth: null })).rejects.toMatchObject({
            code: 'unauthenticated',
        });
    });
    (0, vitest_1.it)('creates wallet doc when none exists', async () => {
        const result = await callActivateWallet({ auth: { uid: 'user1' } });
        (0, vitest_1.expect)(result.success).toBe(true);
        (0, vitest_1.expect)(result.balance).toBe(0);
        (0, vitest_1.expect)(result.pendingBalance).toBe(0);
        (0, vitest_1.expect)(result.status).toBe('active');
        const walletWrite = writeOps.find((w) => w.path === 'wallets/user1' && w.method === 'set');
        (0, vitest_1.expect)(walletWrite).toBeDefined();
        (0, vitest_1.expect)(walletWrite.data.balance).toBe(0);
        (0, vitest_1.expect)(walletWrite.data.pendingBalance).toBe(0);
        (0, vitest_1.expect)(walletWrite.data.currency).toBe('cad');
        (0, vitest_1.expect)(walletWrite.data.status).toBe('active');
    });
    (0, vitest_1.it)('returns existing wallet if already active (idempotent)', async () => {
        setDoc('wallets/user1', {
            balance: 5000,
            pendingBalance: 1000,
            status: 'active',
            currency: 'cad',
        });
        const result = await callActivateWallet({ auth: { uid: 'user1' } });
        (0, vitest_1.expect)(result.success).toBe(true);
        (0, vitest_1.expect)(result.balance).toBe(5000);
        (0, vitest_1.expect)(result.pendingBalance).toBe(1000);
        (0, vitest_1.expect)(result.status).toBe('active');
        // No set write should have occurred
        const walletSet = writeOps.find((w) => w.path === 'wallets/user1' && w.method === 'set');
        (0, vitest_1.expect)(walletSet).toBeUndefined();
    });
    (0, vitest_1.it)('sets correct initial wallet fields including timestamps', async () => {
        await callActivateWallet({ auth: { uid: 'newuser' } });
        const walletWrite = writeOps.find((w) => w.path === 'wallets/newuser' && w.method === 'set');
        (0, vitest_1.expect)(walletWrite).toBeDefined();
        (0, vitest_1.expect)(walletWrite.data).toMatchObject({
            balance: 0,
            pendingBalance: 0,
            currency: 'cad',
            status: 'active',
        });
        (0, vitest_1.expect)(walletWrite.data.activatedAt).toBeDefined();
        (0, vitest_1.expect)(walletWrite.data.updatedAt).toBeDefined();
    });
});
// ===========================================================================
// getWalletInfo
// ===========================================================================
(0, vitest_1.describe)('getWalletInfo', () => {
    (0, vitest_1.it)('requires authentication', async () => {
        await (0, vitest_1.expect)(callGetWalletInfo({ auth: null })).rejects.toThrow('User must be authenticated');
        await (0, vitest_1.expect)(callGetWalletInfo({ auth: null })).rejects.toMatchObject({
            code: 'unauthenticated',
        });
    });
    (0, vitest_1.it)('returns hasWallet: false when no wallet exists', async () => {
        const result = await callGetWalletInfo({ auth: { uid: 'user1' } });
        (0, vitest_1.expect)(result).toEqual({ hasWallet: false });
    });
    (0, vitest_1.it)('returns correct balance and ledger entries when wallet exists', async () => {
        setDoc('wallets/user1', {
            balance: 12000,
            pendingBalance: 3000,
            currency: 'cad',
            status: 'active',
            activatedAt: '2026-01-01',
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
                    createdAt: '2026-05-01',
                },
            },
            {
                id: 'ledger2',
                data: {
                    type: 'sale_credit',
                    amount: 8000,
                    balanceAfter: 17000,
                    description: 'Vente article',
                    createdAt: '2026-04-28',
                },
            },
        ]);
        const result = await callGetWalletInfo({ auth: { uid: 'user1' } });
        (0, vitest_1.expect)(result.hasWallet).toBe(true);
        (0, vitest_1.expect)(result.balance).toBe(12000);
        (0, vitest_1.expect)(result.pendingBalance).toBe(3000);
        (0, vitest_1.expect)(result.currency).toBe('cad');
        (0, vitest_1.expect)(result.status).toBe('active');
        (0, vitest_1.expect)(result.activatedAt).toBe('2026-01-01');
        const ledger = result.ledger;
        (0, vitest_1.expect)(ledger).toHaveLength(2);
        (0, vitest_1.expect)(ledger[0].id).toBe('ledger1');
        (0, vitest_1.expect)(ledger[0].type).toBe('purchase_debit');
        (0, vitest_1.expect)(ledger[0].transactionId).toBe('tx1');
        (0, vitest_1.expect)(ledger[1].id).toBe('ledger2');
        (0, vitest_1.expect)(ledger[1].transactionId).toBeNull(); // missing field => null fallback
    });
});
// ===========================================================================
// walletWithdraw
// ===========================================================================
(0, vitest_1.describe)('walletWithdraw', () => {
    function setupWithdrawable(balance = 5000) {
        setDoc('users/user1', {
            stripeAccountId: 'acct_123',
            stripeChargesEnabled: true,
            stripeBankAccountLast4: '4242',
        });
        setDoc('wallets/user1', {
            balance,
            pendingBalance: 0,
            status: 'active',
            currency: 'cad',
        });
    }
    (0, vitest_1.it)('requires authentication', async () => {
        await (0, vitest_1.expect)(callWalletWithdraw({ auth: null, data: { amount: 1000 } })).rejects.toMatchObject({ code: 'unauthenticated' });
    });
    (0, vitest_1.it)('rejects non-integer amounts', async () => {
        setupWithdrawable();
        await (0, vitest_1.expect)(callWalletWithdraw({ auth: { uid: 'user1' }, data: { amount: 10.5 } })).rejects.toMatchObject({ code: 'invalid-argument' });
    });
    (0, vitest_1.it)('rejects zero amount', async () => {
        setupWithdrawable();
        await (0, vitest_1.expect)(callWalletWithdraw({ auth: { uid: 'user1' }, data: { amount: 0 } })).rejects.toMatchObject({ code: 'invalid-argument' });
    });
    (0, vitest_1.it)('rejects negative amount', async () => {
        setupWithdrawable();
        await (0, vitest_1.expect)(callWalletWithdraw({ auth: { uid: 'user1' }, data: { amount: -500 } })).rejects.toMatchObject({ code: 'invalid-argument' });
    });
    (0, vitest_1.it)('rejects if amount < 1000 (min $10)', async () => {
        setupWithdrawable();
        await (0, vitest_1.expect)(callWalletWithdraw({ auth: { uid: 'user1' }, data: { amount: 999 } })).rejects.toMatchObject({ code: 'invalid-argument' });
        await (0, vitest_1.expect)(callWalletWithdraw({ auth: { uid: 'user1' }, data: { amount: 999 } })).rejects.toThrow('retrait minimum');
    });
    (0, vitest_1.it)('rejects if user has no stripeAccountId', async () => {
        setDoc('users/user1', { stripeChargesEnabled: true });
        setDoc('wallets/user1', { balance: 5000, status: 'active' });
        await (0, vitest_1.expect)(callWalletWithdraw({ auth: { uid: 'user1' }, data: { amount: 1000 } })).rejects.toMatchObject({ code: 'failed-precondition' });
        await (0, vitest_1.expect)(callWalletWithdraw({ auth: { uid: 'user1' }, data: { amount: 1000 } })).rejects.toThrow('compte de paiement');
    });
    (0, vitest_1.it)('rejects if stripeChargesEnabled is false', async () => {
        setDoc('users/user1', {
            stripeAccountId: 'acct_123',
            stripeChargesEnabled: false,
        });
        setDoc('wallets/user1', { balance: 5000, status: 'active' });
        await (0, vitest_1.expect)(callWalletWithdraw({ auth: { uid: 'user1' }, data: { amount: 1000 } })).rejects.toMatchObject({ code: 'failed-precondition' });
        await (0, vitest_1.expect)(callWalletWithdraw({ auth: { uid: 'user1' }, data: { amount: 1000 } })).rejects.toThrow('pas encore actif');
    });
    (0, vitest_1.it)('rejects if no wallet exists', async () => {
        setDoc('users/user1', {
            stripeAccountId: 'acct_123',
            stripeChargesEnabled: true,
        });
        await (0, vitest_1.expect)(callWalletWithdraw({ auth: { uid: 'user1' }, data: { amount: 1000 } })).rejects.toMatchObject({ code: 'not-found' });
        await (0, vitest_1.expect)(callWalletWithdraw({ auth: { uid: 'user1' }, data: { amount: 1000 } })).rejects.toThrow('porte-monnaie');
    });
    (0, vitest_1.it)('rejects if amount > balance', async () => {
        setupWithdrawable(2000);
        await (0, vitest_1.expect)(callWalletWithdraw({ auth: { uid: 'user1' }, data: { amount: 3000 } })).rejects.toMatchObject({ code: 'failed-precondition' });
        await (0, vitest_1.expect)(callWalletWithdraw({ auth: { uid: 'user1' }, data: { amount: 3000 } })).rejects.toThrow('Solde insuffisant');
    });
    (0, vitest_1.it)('correctly debits wallet balance and creates ledger entry', async () => {
        setupWithdrawable(5000);
        const result = await callWalletWithdraw({
            auth: { uid: 'user1' },
            data: { amount: 2000 },
        });
        (0, vitest_1.expect)(result.success).toBe(true);
        (0, vitest_1.expect)(result.newBalance).toBe(3000);
        (0, vitest_1.expect)(result.transferId).toBe('tr_123');
        (0, vitest_1.expect)(result.payoutId).toBe('po_123');
        // Wallet was debited
        const walletUpdate = writeOps.find((w) => w.path === 'wallets/user1' && w.method === 'update');
        (0, vitest_1.expect)(walletUpdate).toBeDefined();
        // Ledger entry was created
        const ledgerSet = writeOps.find((w) => w.path.startsWith('wallets/user1/ledger/') && w.method === 'set');
        (0, vitest_1.expect)(ledgerSet).toBeDefined();
        (0, vitest_1.expect)(ledgerSet.data.type).toBe('withdrawal');
        (0, vitest_1.expect)(ledgerSet.data.amount).toBe(2000);
        (0, vitest_1.expect)(ledgerSet.data.balanceAfter).toBe(3000);
    });
    (0, vitest_1.it)('accepts exact minimum amount of 1000', async () => {
        setupWithdrawable(1000);
        const result = await callWalletWithdraw({
            auth: { uid: 'user1' },
            data: { amount: 1000 },
        });
        (0, vitest_1.expect)(result.success).toBe(true);
        (0, vitest_1.expect)(result.newBalance).toBe(0);
    });
    (0, vitest_1.it)('calls Stripe transfers.create and payouts.create with correct params', async () => {
        setupWithdrawable(5000);
        let transferArgs = [];
        let payoutArgs = [];
        mockStripeTransfersCreate.fn = async (...args) => {
            transferArgs = args;
            return { id: 'tr_456' };
        };
        mockStripePayoutsCreate.fn = async (...args) => {
            payoutArgs = args;
            return { id: 'po_456' };
        };
        const result = await callWalletWithdraw({
            auth: { uid: 'user1' },
            data: { amount: 2000 },
        });
        (0, vitest_1.expect)(result.transferId).toBe('tr_456');
        (0, vitest_1.expect)(result.payoutId).toBe('po_456');
        (0, vitest_1.expect)(transferArgs[0]).toEqual({
            amount: 2000,
            currency: 'cad',
            destination: 'acct_123',
            metadata: {
                firebaseUserId: 'user1',
                walletWithdrawal: 'true',
            },
        });
        (0, vitest_1.expect)(payoutArgs[0]).toEqual({
            amount: 2000,
            currency: 'cad',
            metadata: {
                firebaseUserId: 'user1',
                walletWithdrawal: 'true',
            },
        });
        (0, vitest_1.expect)(payoutArgs[1]).toEqual({ stripeAccount: 'acct_123' });
    });
    (0, vitest_1.it)('reverts wallet debit when Stripe transfer fails', async () => {
        setupWithdrawable(5000);
        // Track runTransaction call count
        let txCallCount = 0;
        const origRunTransaction = mockDb.runTransaction;
        mockDb.runTransaction = async (fn) => {
            txCallCount++;
            const tx = createMockTransaction();
            return fn(tx);
        };
        mockStripeTransfersCreate.fn = async () => {
            throw new Error('Stripe network error');
        };
        await (0, vitest_1.expect)(callWalletWithdraw({ auth: { uid: 'user1' }, data: { amount: 2000 } })).rejects.toThrow('Stripe network error');
        // Two runTransaction calls: debit + revert
        (0, vitest_1.expect)(txCallCount).toBe(2);
        // Revert should update the wallet again
        const walletUpdates = writeOps.filter((w) => w.path === 'wallets/user1' && w.method === 'update');
        (0, vitest_1.expect)(walletUpdates.length).toBeGreaterThanOrEqual(2);
        // Restore
        mockDb.runTransaction = origRunTransaction;
    });
    (0, vitest_1.it)('reverts wallet debit when Stripe payout fails', async () => {
        setupWithdrawable(5000);
        let txCallCount = 0;
        mockDb.runTransaction = async (fn) => {
            txCallCount++;
            const tx = createMockTransaction();
            return fn(tx);
        };
        mockStripePayoutsCreate.fn = async () => {
            throw new Error('Payout failed');
        };
        await (0, vitest_1.expect)(callWalletWithdraw({ auth: { uid: 'user1' }, data: { amount: 2000 } })).rejects.toThrow('Payout failed');
        (0, vitest_1.expect)(txCallCount).toBe(2);
    });
    (0, vitest_1.it)('rejects string amounts', async () => {
        setupWithdrawable();
        await (0, vitest_1.expect)(callWalletWithdraw({ auth: { uid: 'user1' }, data: { amount: '1000' } })).rejects.toMatchObject({ code: 'invalid-argument' });
    });
    (0, vitest_1.it)('rejects when data is undefined', async () => {
        setupWithdrawable();
        await (0, vitest_1.expect)(callWalletWithdraw({ auth: { uid: 'user1' }, data: undefined })).rejects.toMatchObject({ code: 'invalid-argument' });
    });
    (0, vitest_1.it)('handles inactive wallet', async () => {
        setDoc('users/user1', {
            stripeAccountId: 'acct_123',
            stripeChargesEnabled: true,
        });
        setDoc('wallets/user1', { balance: 5000, pendingBalance: 0, status: 'suspended' });
        await (0, vitest_1.expect)(callWalletWithdraw({ auth: { uid: 'user1' }, data: { amount: 1000 } })).rejects.toMatchObject({ code: 'failed-precondition' });
        await (0, vitest_1.expect)(callWalletWithdraw({ auth: { uid: 'user1' }, data: { amount: 1000 } })).rejects.toThrow('pas actif');
    });
    (0, vitest_1.it)('works at exact balance', async () => {
        setDoc('users/user1', {
            stripeAccountId: 'acct_123',
            stripeChargesEnabled: true,
            stripeBankAccountLast4: '9876',
        });
        setDoc('wallets/user1', { balance: 1000, pendingBalance: 0, status: 'active' });
        const result = await callWalletWithdraw({
            auth: { uid: 'user1' },
            data: { amount: 1000 },
        });
        (0, vitest_1.expect)(result.success).toBe(true);
        (0, vitest_1.expect)(result.newBalance).toBe(0);
    });
});
// ===========================================================================
// payWithWallet
// ===========================================================================
(0, vitest_1.describe)('payWithWallet', () => {
    function setupPayable(opts) {
        const { buyerBalance = 10000, totalAmount = 50, sellerPayout = 45, sellerId = 'seller1', status = 'pending_payment', sellerHasWallet = true, articleId = 'article1', } = opts !== null && opts !== void 0 ? opts : {};
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
    (0, vitest_1.it)('requires authentication', async () => {
        await (0, vitest_1.expect)(callPayWithWallet({ auth: null, data: { transactionId: 'tx1' } })).rejects.toMatchObject({ code: 'unauthenticated' });
    });
    (0, vitest_1.it)('rejects if transactionId is missing', async () => {
        await (0, vitest_1.expect)(callPayWithWallet({ auth: { uid: 'buyer1' }, data: {} })).rejects.toMatchObject({ code: 'invalid-argument' });
    });
    (0, vitest_1.it)('rejects if transactionId is empty string', async () => {
        await (0, vitest_1.expect)(callPayWithWallet({ auth: { uid: 'buyer1' }, data: { transactionId: '' } })).rejects.toMatchObject({ code: 'invalid-argument' });
    });
    (0, vitest_1.it)('rejects if transactionId is non-string type', async () => {
        await (0, vitest_1.expect)(callPayWithWallet({ auth: { uid: 'buyer1' }, data: { transactionId: 12345 } })).rejects.toMatchObject({ code: 'invalid-argument' });
    });
    (0, vitest_1.it)('rejects if transaction does not exist', async () => {
        setDoc('wallets/buyer1', { balance: 10000, status: 'active' });
        await (0, vitest_1.expect)(callPayWithWallet({
            auth: { uid: 'buyer1' },
            data: { transactionId: 'tx_nonexistent' },
        })).rejects.toMatchObject({ code: 'not-found' });
    });
    (0, vitest_1.it)('rejects if caller is not the buyer', async () => {
        setupPayable();
        await (0, vitest_1.expect)(callPayWithWallet({ auth: { uid: 'intruder' }, data: { transactionId: 'tx1' } })).rejects.toMatchObject({ code: 'permission-denied' });
    });
    (0, vitest_1.it)('rejects if transaction not in pending_payment status', async () => {
        setupPayable({ status: 'paid' });
        await (0, vitest_1.expect)(callPayWithWallet({ auth: { uid: 'buyer1' }, data: { transactionId: 'tx1' } })).rejects.toThrow('Cannot pay for transaction in status paid');
    });
    (0, vitest_1.it)('rejects various non-payable statuses', async () => {
        for (const status of ['cancelled', 'delivered', 'refunded', 'shipped']) {
            // Clear state for each iteration
            writeOps.length = 0;
            for (const key of Object.keys(docSnapshots))
                delete docSnapshots[key];
            setupPayable({ status });
            await (0, vitest_1.expect)(callPayWithWallet({ auth: { uid: 'buyer1' }, data: { transactionId: 'tx1' } })).rejects.toThrow(`Cannot pay for transaction in status ${status}`);
        }
    });
    (0, vitest_1.it)('rejects if buyer has no wallet', async () => {
        setDoc('transactions/tx1', {
            buyerId: 'buyer1',
            sellerId: 'seller1',
            status: 'pending_payment',
            totalAmount: 50,
            sellerPayout: 45,
            articleId: 'article1',
        });
        await (0, vitest_1.expect)(callPayWithWallet({ auth: { uid: 'buyer1' }, data: { transactionId: 'tx1' } })).rejects.toMatchObject({ code: 'failed-precondition' });
        await (0, vitest_1.expect)(callPayWithWallet({ auth: { uid: 'buyer1' }, data: { transactionId: 'tx1' } })).rejects.toThrow('porte-monnaie');
    });
    (0, vitest_1.it)('rejects if buyer wallet balance < total amount', async () => {
        setupPayable({ buyerBalance: 4999, totalAmount: 50 });
        await (0, vitest_1.expect)(callPayWithWallet({ auth: { uid: 'buyer1' }, data: { transactionId: 'tx1' } })).rejects.toMatchObject({ code: 'failed-precondition' });
        await (0, vitest_1.expect)(callPayWithWallet({ auth: { uid: 'buyer1' }, data: { transactionId: 'tx1' } })).rejects.toThrow('Solde insuffisant');
    });
    (0, vitest_1.it)('correctly debits buyer wallet', async () => {
        setupPayable({ buyerBalance: 10000, totalAmount: 50 });
        const result = await callPayWithWallet({
            auth: { uid: 'buyer1' },
            data: { transactionId: 'tx1' },
        });
        (0, vitest_1.expect)(result.success).toBe(true);
        (0, vitest_1.expect)(result.newBalance).toBe(5000); // 10000 - 5000
        const buyerWalletUpdate = writeOps.find((w) => w.path === 'wallets/buyer1' && w.method === 'update');
        (0, vitest_1.expect)(buyerWalletUpdate).toBeDefined();
    });
    (0, vitest_1.it)('correctly credits seller pendingBalance when seller has wallet', async () => {
        setupPayable({ sellerHasWallet: true, sellerPayout: 45 });
        await callPayWithWallet({
            auth: { uid: 'buyer1' },
            data: { transactionId: 'tx1' },
        });
        const sellerWalletUpdate = writeOps.find((w) => w.path === 'wallets/seller1' && w.method === 'update');
        (0, vitest_1.expect)(sellerWalletUpdate).toBeDefined();
    });
    (0, vitest_1.it)('marks transaction as paid with paidVia wallet', async () => {
        setupPayable();
        await callPayWithWallet({
            auth: { uid: 'buyer1' },
            data: { transactionId: 'tx1' },
        });
        const txUpdate = writeOps.find((w) => w.path === 'transactions/tx1' && w.method === 'update');
        (0, vitest_1.expect)(txUpdate).toBeDefined();
        (0, vitest_1.expect)(txUpdate.data.status).toBe('paid');
        (0, vitest_1.expect)(txUpdate.data.paidVia).toBe('wallet');
    });
    (0, vitest_1.it)('marks article as isSold: true', async () => {
        setupPayable({ articleId: 'article1' });
        await callPayWithWallet({
            auth: { uid: 'buyer1' },
            data: { transactionId: 'tx1' },
        });
        const articleUpdate = writeOps.find((w) => w.path === 'articles/article1' && w.method === 'update');
        (0, vitest_1.expect)(articleUpdate).toBeDefined();
        (0, vitest_1.expect)(articleUpdate.data.isSold).toBe(true);
    });
    (0, vitest_1.it)('creates ledger entry for buyer with correct type and balanceAfter', async () => {
        setupPayable({ buyerBalance: 8000, totalAmount: 30 });
        await callPayWithWallet({
            auth: { uid: 'buyer1' },
            data: { transactionId: 'tx1' },
        });
        const ledgerEntry = writeOps.find((w) => w.path.startsWith('wallets/buyer1/ledger/') && w.method === 'set');
        (0, vitest_1.expect)(ledgerEntry).toBeDefined();
        (0, vitest_1.expect)(ledgerEntry.data.type).toBe('purchase_debit');
        (0, vitest_1.expect)(ledgerEntry.data.amount).toBe(3000);
        (0, vitest_1.expect)(ledgerEntry.data.balanceAfter).toBe(5000);
        (0, vitest_1.expect)(ledgerEntry.data.transactionId).toBe('tx1');
    });
    (0, vitest_1.it)('does not update seller wallet when seller has no wallet', async () => {
        setupPayable({ sellerHasWallet: false, totalAmount: 50, sellerPayout: 45 });
        const result = await callPayWithWallet({
            auth: { uid: 'buyer1' },
            data: { transactionId: 'tx1' },
        });
        (0, vitest_1.expect)(result.success).toBe(true);
        const sellerWalletUpdate = writeOps.find((w) => w.path === 'wallets/seller1' && w.method === 'update');
        (0, vitest_1.expect)(sellerWalletUpdate).toBeUndefined();
    });
    (0, vitest_1.it)('handles exact balance match (balance === totalAmount in cents)', async () => {
        setupPayable({ buyerBalance: 5000, totalAmount: 50 });
        const result = await callPayWithWallet({
            auth: { uid: 'buyer1' },
            data: { transactionId: 'tx1' },
        });
        (0, vitest_1.expect)(result.success).toBe(true);
        (0, vitest_1.expect)(result.newBalance).toBe(0);
    });
    (0, vitest_1.it)('rejects zero balance wallet trying to pay', async () => {
        setupPayable({ buyerBalance: 0, totalAmount: 50 });
        await (0, vitest_1.expect)(callPayWithWallet({ auth: { uid: 'buyer1' }, data: { transactionId: 'tx1' } })).rejects.toMatchObject({ code: 'failed-precondition' });
    });
    (0, vitest_1.it)('stores walletAmountUsed on transaction', async () => {
        setupPayable({ totalAmount: 25 });
        await callPayWithWallet({
            auth: { uid: 'buyer1' },
            data: { transactionId: 'tx1' },
        });
        const txUpdate = writeOps.find((w) => w.path === 'transactions/tx1' && w.method === 'update');
        (0, vitest_1.expect)(txUpdate).toBeDefined();
        (0, vitest_1.expect)(txUpdate.data.walletAmountUsed).toBe(2500);
    });
    (0, vitest_1.it)('handles inactive buyer wallet', async () => {
        setDoc('transactions/tx1', {
            buyerId: 'buyer1',
            sellerId: 'seller1',
            status: 'pending_payment',
            totalAmount: 10,
            sellerPayout: 9,
            articleId: 'a1',
        });
        setDoc('wallets/buyer1', { balance: 5000, pendingBalance: 0, status: 'suspended' });
        await (0, vitest_1.expect)(callPayWithWallet({ auth: { uid: 'buyer1' }, data: { transactionId: 'tx1' } })).rejects.toMatchObject({ code: 'failed-precondition' });
        await (0, vitest_1.expect)(callPayWithWallet({ auth: { uid: 'buyer1' }, data: { transactionId: 'tx1' } })).rejects.toThrow('pas actif');
    });
    (0, vitest_1.it)('rejects transaction with zero totalAmount', async () => {
        setDoc('transactions/tx1', {
            buyerId: 'buyer1',
            sellerId: 'seller1',
            status: 'pending_payment',
            totalAmount: 0,
            sellerPayout: 0,
            articleId: 'a1',
        });
        setDoc('wallets/buyer1', { balance: 5000, pendingBalance: 0, status: 'active' });
        await (0, vitest_1.expect)(callPayWithWallet({ auth: { uid: 'buyer1' }, data: { transactionId: 'tx1' } })).rejects.toMatchObject({ code: 'failed-precondition' });
        await (0, vitest_1.expect)(callPayWithWallet({ auth: { uid: 'buyer1' }, data: { transactionId: 'tx1' } })).rejects.toThrow('Transaction amount is invalid');
    });
});
// ===========================================================================
// Cross-cutting: atomicity
// ===========================================================================
(0, vitest_1.describe)('atomicity guarantees', () => {
    (0, vitest_1.it)('activateWallet uses runTransaction', async () => {
        let txCalled = false;
        mockDb.runTransaction = async (fn) => {
            txCalled = true;
            const tx = createMockTransaction();
            return fn(tx);
        };
        await callActivateWallet({ auth: { uid: 'user1' } });
        (0, vitest_1.expect)(txCalled).toBe(true);
    });
    (0, vitest_1.it)('payWithWallet uses runTransaction for all mutations', async () => {
        let txCalled = false;
        mockDb.runTransaction = async (fn) => {
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
        (0, vitest_1.expect)(txCalled).toBe(true);
    });
    (0, vitest_1.it)('walletWithdraw uses runTransaction for debit', async () => {
        let txCalled = false;
        mockDb.runTransaction = async (fn) => {
            txCalled = true;
            const tx = createMockTransaction();
            return fn(tx);
        };
        setDoc('users/user1', {
            stripeAccountId: 'acct_123',
            stripeChargesEnabled: true,
            stripeBankAccountLast4: '4242',
        });
        setDoc('wallets/user1', { balance: 5000, pendingBalance: 0, status: 'active' });
        await callWalletWithdraw({
            auth: { uid: 'user1' },
            data: { amount: 1000 },
        });
        (0, vitest_1.expect)(txCalled).toBe(true);
    });
});
//# sourceMappingURL=wallet.test.js.map