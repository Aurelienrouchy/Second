"use strict";
/**
 * In-memory Firestore + Stripe mock harness for integration-style unit tests
 * of the critical financial code paths (Stripe webhook, transactionExpiration,
 * walletWithdraw, createTransaction shipping re-pricing).
 *
 * This is a plain factory (NOT a vitest file) so it can be invoked from inside
 * `vi.hoisted(() => ...)` in each *.test.ts (vi.mock factories are hoisted above
 * imports and may only reference hoisted symbols).
 *
 * Design goals — coherent with the proven harness in callable/wallet.test.ts:
 *  - Writes are recorded as an ordered op log (assert on what was written).
 *  - Writes ALSO commit into the in-memory doc store so a later read sees them.
 *    This is what makes idempotence/dedup tests REAL: replaying the same Stripe
 *    event must find the marker the first run created and short-circuit.
 *  - FieldValue.increment(n) is applied to the committed store so balance buckets
 *    converge to a real number — "no double credit" can be asserted on the final
 *    committed value, not just on the op log.
 *  - runTransaction stages writes and commits them atomically at the end of the
 *    callback (mirrors Firestore: reads see pre-tx state within the same tx).
 *
 * All money figures follow the production convention: wallet/ledger = CENTS,
 * transaction.totalAmount/shippingCost/sellerPayout = DOLLARS.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createFirestoreMock = createFirestoreMock;
exports.createStripeMock = createStripeMock;
function isSentinel(v) {
    return typeof v === 'object' && v !== null && '__sentinel' in v;
}
/**
 * Apply a write (with sentinel resolution) onto a target document object,
 * mutating it in place. Mirrors Firestore semantics for increment/serverTimestamp.
 */
function applyWrite(target, data, mode) {
    if (mode === 'set') {
        // Overwrite: clear existing keys first.
        for (const k of Object.keys(target))
            delete target[k];
    }
    for (const [k, v] of Object.entries(data)) {
        if (isSentinel(v)) {
            if (v.__sentinel === 'increment') {
                const cur = typeof target[k] === 'number' ? target[k] : 0;
                target[k] = cur + v.value;
            }
            else if (v.__sentinel === 'serverTimestamp') {
                target[k] = { __ts: true };
            }
            else if (v.__sentinel === 'arrayUnion') {
                const arr = Array.isArray(target[k]) ? target[k].slice() : [];
                for (const item of v.values)
                    if (!arr.includes(item))
                        arr.push(item);
                target[k] = arr;
            }
        }
        else {
            target[k] = v;
        }
    }
}
function createFirestoreMock() {
    // Committed document store. Absence of a key => doc does not exist.
    const store = new Map();
    // Explicit "non-existent" markers (setDoc(path, null)).
    const tombstones = new Set();
    const queries = new Map();
    const writeOps = [];
    let autoId = 0;
    function snapFor(path) {
        const ref = makeDocRef(path);
        const exists = store.has(path) && !tombstones.has(path);
        const raw = store.get(path);
        return {
            exists,
            id: path.split('/').pop(),
            ref,
            data: () => (exists && raw ? Object.assign({}, raw) : undefined),
        };
    }
    function commit(op) {
        var _a;
        writeOps.push(op);
        if (op.method === 'delete') {
            store.delete(op.path);
            tombstones.add(op.path);
            return;
        }
        tombstones.delete(op.path);
        const existing = (_a = store.get(op.path)) !== null && _a !== void 0 ? _a : {};
        const next = Object.assign({}, existing);
        const mode = op.method === 'create'
            ? 'set'
            : op.method === 'set'
                ? op.merge
                    ? 'merge'
                    : 'set'
                : 'update';
        applyWrite(next, op.data, mode);
        store.set(op.path, next);
    }
    function makeDocRef(path) {
        return {
            path,
            id: path.split('/').pop(),
            get: async () => snapFor(path),
            set: async (data, opts) => {
                commit({ method: 'set', path, data, merge: opts === null || opts === void 0 ? void 0 : opts.merge });
            },
            update: async (data) => {
                commit({ method: 'update', path, data });
            },
            create: async (data) => {
                commit({ method: 'create', path, data });
            },
            delete: async () => {
                commit({ method: 'delete', path, data: {} });
            },
            collection: (sub) => makeCollectionRef(`${path}/${sub}`),
        };
    }
    /**
     * Resolve the candidate docs for a collection query. Seeded docs (setQuery)
     * take priority — useful for fixing query results regardless of the live
     * store. If none are seeded, fall back to scanning the live store for docs
     * whose path is a direct child of the collection (so committed writes appear
     * in subsequent queries — required for idempotence tests).
     */
    function candidateDocs(collPath) {
        const seeded = queries.get(collPath);
        if (seeded)
            return seeded.map((d) => ({ id: d.id, data: Object.assign({}, d.data) }));
        const out = [];
        const prefix = `${collPath}/`;
        for (const [path, data] of store.entries()) {
            if (tombstones.has(path))
                continue;
            const rest = path.slice(prefix.length);
            if (path.startsWith(prefix) && !rest.includes('/')) {
                out.push({ id: rest, data: Object.assign({}, data) });
            }
        }
        return out;
    }
    /** Coerce Dates/Timestamps to a millisecond number for ordered comparisons. */
    function ord(v) {
        if (v instanceof Date)
            return v.getTime();
        if (typeof v === 'object' && v !== null && typeof v.toMillis === 'function') {
            return v.toMillis();
        }
        return v;
    }
    function matchesWhere(data, clauses) {
        return clauses.every((c) => {
            if (c.op === '==')
                return data[c.field] === c.value;
            if (c.op === '<')
                return ord(data[c.field]) < ord(c.value);
            if (c.op === '<=')
                return ord(data[c.field]) <= ord(c.value);
            if (c.op === '>')
                return ord(data[c.field]) > ord(c.value);
            if (c.op === '>=')
                return ord(data[c.field]) >= ord(c.value);
            // Unknown op: don't filter it out.
            return true;
        });
    }
    function makeQuery(collPath, clauses, lim) {
        const q = {
            where: (...a) => makeQuery(collPath, [...clauses, { field: a[0], op: a[1], value: a[2] }], lim),
            orderBy: () => makeQuery(collPath, clauses, lim),
            limit: (...a) => makeQuery(collPath, clauses, a[0]),
            startAfter: () => makeQuery(collPath, clauses, lim),
            get: async () => {
                let docs = candidateDocs(collPath).filter((d) => matchesWhere(d.data, clauses));
                if (lim != null)
                    docs = docs.slice(0, lim);
                const mapped = docs.map((d) => ({
                    id: d.id,
                    ref: makeDocRef(`${collPath}/${d.id}`),
                    data: () => (Object.assign({}, d.data)),
                }));
                return { docs: mapped, empty: mapped.length === 0, size: mapped.length };
            },
        };
        return q;
    }
    function makeCollectionRef(path) {
        return {
            path,
            doc: (id) => makeDocRef(`${path}/${id !== null && id !== void 0 ? id : `auto_${++autoId}`}`),
            add: async (data) => {
                const ref = makeDocRef(`${path}/auto_${++autoId}`);
                commit({ method: 'set', path: ref.path, data });
                return ref;
            },
            where: (...a) => makeQuery(path, [{ field: a[0], op: a[1], value: a[2] }], null),
            orderBy: () => makeQuery(path, [], null),
            limit: (...a) => makeQuery(path, [], a[0]),
            get: async () => makeQuery(path, [], null).get(),
        };
    }
    function makeTransaction() {
        // Stage writes; commit atomically when the callback resolves so reads inside
        // the same tx see pre-tx state (Firestore semantics).
        const staged = [];
        const tx = {
            get: async (ref) => snapFor(ref.path),
            set: (ref, data, opts) => void staged.push({ method: 'set', path: ref.path, data, merge: opts === null || opts === void 0 ? void 0 : opts.merge }),
            update: (ref, data) => void staged.push({ method: 'update', path: ref.path, data }),
            create: (ref, data) => void staged.push({ method: 'create', path: ref.path, data }),
            delete: (ref) => void staged.push({ method: 'delete', path: ref.path, data: {} }),
        };
        return { tx, flush: () => staged.forEach(commit) };
    }
    const db = {
        collection: (name) => makeCollectionRef(name),
        runTransaction: async (fn) => {
            const { tx, flush } = makeTransaction();
            const result = await fn(tx);
            flush();
            return result;
        },
        batch: () => {
            const staged = [];
            const b = {
                set: (ref, data, opts) => void staged.push({ method: 'set', path: ref.path, data, merge: opts === null || opts === void 0 ? void 0 : opts.merge }),
                update: (ref, data) => void staged.push({ method: 'update', path: ref.path, data }),
                delete: (ref) => void staged.push({ method: 'delete', path: ref.path, data: {} }),
                commit: async () => {
                    staged.forEach(commit);
                },
            };
            return b;
        },
    };
    const FieldValue = {
        serverTimestamp: () => ({ __sentinel: 'serverTimestamp' }),
        increment: (n) => ({ __sentinel: 'increment', value: n }),
        arrayUnion: (...args) => ({ __sentinel: 'arrayUnion', values: args }),
    };
    return {
        writeOps,
        db,
        FieldValue,
        setDoc: (path, data) => {
            if (data === null) {
                store.delete(path);
                tombstones.add(path);
            }
            else {
                tombstones.delete(path);
                store.set(path, Object.assign({}, data));
            }
        },
        getDoc: (path) => {
            if (tombstones.has(path))
                return undefined;
            const v = store.get(path);
            return v ? Object.assign({}, v) : undefined;
        },
        setQuery: (path, docs) => {
            queries.set(path, docs.map((d) => ({ id: d.id, data: Object.assign({}, d.data) })));
        },
        reset: () => {
            store.clear();
            tombstones.clear();
            queries.clear();
            writeOps.length = 0;
            autoId = 0;
        },
        sumIncrements: (path, field) => {
            return writeOps
                .filter((op) => op.path === path)
                .reduce((sum, op) => {
                const v = op.data[field];
                if (isSentinel(v) && v.__sentinel === 'increment')
                    return sum + v.value;
                return sum;
            }, 0);
        },
        countWrites: (pred) => writeOps.filter(pred).length,
    };
}
function createStripeMock() {
    const calls = {
        refundsCreate: [],
        transfersCreate: [],
        payoutsCreate: [],
        paymentIntentsRetrieve: [],
        paymentIntentsCancel: [],
    };
    const impl = {
        constructEvent: () => {
            throw new Error('constructEvent not stubbed for this test');
        },
        refundsCreate: async () => ({ id: 'rf_default' }),
        paymentIntentsRetrieve: async () => ({ status: 'requires_payment_method' }),
        paymentIntentsCancel: async () => ({ id: 'pi_cancelled' }),
        transfersCreate: async () => ({ id: 'tr_default' }),
        payoutsCreate: async () => ({ id: 'po_default' }),
    };
    const client = {
        webhooks: {
            constructEvent: (...a) => impl.constructEvent(...a),
        },
        refunds: {
            create: (...a) => {
                calls.refundsCreate.push(a);
                return impl.refundsCreate(...a);
            },
        },
        paymentIntents: {
            retrieve: (...a) => {
                calls.paymentIntentsRetrieve.push(a);
                return impl.paymentIntentsRetrieve(...a);
            },
            cancel: (...a) => {
                calls.paymentIntentsCancel.push(a);
                return impl.paymentIntentsCancel(...a);
            },
        },
        transfers: {
            create: (...a) => {
                calls.transfersCreate.push(a);
                return impl.transfersCreate(...a);
            },
        },
        payouts: {
            create: (...a) => {
                calls.payoutsCreate.push(a);
                return impl.payoutsCreate(...a);
            },
        },
    };
    return {
        impl,
        client,
        calls,
        reset: () => {
            impl.constructEvent = () => {
                throw new Error('constructEvent not stubbed for this test');
            };
            impl.refundsCreate = async () => ({ id: 'rf_default' });
            impl.paymentIntentsRetrieve = async () => ({ status: 'requires_payment_method' });
            impl.paymentIntentsCancel = async () => ({ id: 'pi_cancelled' });
            impl.transfersCreate = async () => ({ id: 'tr_default' });
            impl.payoutsCreate = async () => ({ id: 'po_default' });
            calls.refundsCreate.length = 0;
            calls.transfersCreate.length = 0;
            calls.payoutsCreate.length = 0;
            calls.paymentIntentsRetrieve.length = 0;
            calls.paymentIntentsCancel.length = 0;
        },
    };
}
//# sourceMappingURL=firestoreMock.js.map