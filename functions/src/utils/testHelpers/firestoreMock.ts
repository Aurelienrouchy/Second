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

// ---------------------------------------------------------------------------
// Sentinel types matching firebase-admin FieldValue
// ---------------------------------------------------------------------------

export interface IncrementSentinel {
  __sentinel: 'increment';
  value: number;
}
export interface ServerTimestampSentinel {
  __sentinel: 'serverTimestamp';
}
export interface ArrayUnionSentinel {
  __sentinel: 'arrayUnion';
  values: unknown[];
}

type Sentinel = IncrementSentinel | ServerTimestampSentinel | ArrayUnionSentinel;

function isSentinel(v: unknown): v is Sentinel {
  return typeof v === 'object' && v !== null && '__sentinel' in (v as Record<string, unknown>);
}

export interface WriteOp {
  method: 'set' | 'update' | 'create' | 'delete';
  path: string;
  data: Record<string, unknown>;
  /** set({ merge: true }) */
  merge?: boolean;
}

type DocData = Record<string, unknown>;

export interface MockFirestore {
  /** Ordered log of every write op (incl. those staged then committed by a tx). */
  writeOps: WriteOp[];
  /** Seed/replace a document. Pass null to mark it non-existent. */
  setDoc(path: string, data: DocData | null): void;
  /** Read the current committed data for a path (after increments applied). */
  getDoc(path: string): DocData | undefined;
  /** Seed a query result keyed by collection path. */
  setQuery(path: string, docs: Array<{ id: string; data: DocData }>): void;
  /** Reset all state (call in beforeEach). */
  reset(): void;
  /** The mocked `db` object (mock of config/firebase `db`). */
  db: MockDb;
  /** The mocked `FieldValue` (mock of config/firebase `FieldValue`). */
  FieldValue: MockFieldValue;
  /**
   * Sum of all increment() deltas applied to a field on a path across the whole
   * run (including reverts). Useful to prove "exactly one credit of X".
   */
  sumIncrements(path: string, field: string): number;
  /** Count write ops matching a predicate. */
  countWrites(pred: (op: WriteOp) => boolean): number;
}

interface MockDb {
  collection(name: string): MockCollectionRef;
  runTransaction<T>(fn: (tx: MockTransaction) => Promise<T>): Promise<T>;
  batch(): MockBatch;
}

interface MockFieldValue {
  serverTimestamp(): ServerTimestampSentinel;
  increment(n: number): IncrementSentinel;
  arrayUnion(...args: unknown[]): ArrayUnionSentinel;
}

interface MockDocRef {
  path: string;
  id: string;
  get(): Promise<MockSnap>;
  set(data: DocData, opts?: { merge?: boolean }): Promise<void>;
  update(data: DocData): Promise<void>;
  create(data: DocData): Promise<void>;
  delete(): Promise<void>;
  collection(sub: string): MockCollectionRef;
}

interface MockCollectionRef {
  path: string;
  doc(id?: string): MockDocRef;
  add(data: DocData): Promise<MockDocRef>;
  where(...a: unknown[]): MockQuery;
  orderBy(...a: unknown[]): MockQuery;
  limit(...a: unknown[]): MockQuery;
  get(): Promise<MockQuerySnap>;
}

interface MockQuery {
  where(...a: unknown[]): MockQuery;
  orderBy(...a: unknown[]): MockQuery;
  limit(...a: unknown[]): MockQuery;
  startAfter(...a: unknown[]): MockQuery;
  get(): Promise<MockQuerySnap>;
}

interface MockSnap {
  exists: boolean;
  id: string;
  ref: MockDocRef;
  data(): DocData | undefined;
}

interface MockQuerySnap {
  docs: Array<{ id: string; ref: MockDocRef; data(): DocData }>;
  empty: boolean;
  size: number;
}

interface MockTransaction {
  get(ref: MockDocRef): Promise<MockSnap>;
  set(ref: MockDocRef, data: DocData, opts?: { merge?: boolean }): void;
  update(ref: MockDocRef, data: DocData): void;
  create(ref: MockDocRef, data: DocData): void;
  delete(ref: MockDocRef): void;
}

interface MockBatch {
  set(ref: MockDocRef, data: DocData, opts?: { merge?: boolean }): void;
  update(ref: MockDocRef, data: DocData): void;
  delete(ref: MockDocRef): void;
  commit(): Promise<void>;
}

/**
 * Apply a write (with sentinel resolution) onto a target document object,
 * mutating it in place. Mirrors Firestore semantics for increment/serverTimestamp.
 */
function applyWrite(
  target: DocData,
  data: DocData,
  mode: 'set' | 'update' | 'merge'
): void {
  if (mode === 'set') {
    // Overwrite: clear existing keys first.
    for (const k of Object.keys(target)) delete target[k];
  }
  for (const [k, v] of Object.entries(data)) {
    if (isSentinel(v)) {
      if (v.__sentinel === 'increment') {
        const cur = typeof target[k] === 'number' ? (target[k] as number) : 0;
        target[k] = cur + v.value;
      } else if (v.__sentinel === 'serverTimestamp') {
        target[k] = { __ts: true };
      } else if (v.__sentinel === 'arrayUnion') {
        const arr = Array.isArray(target[k]) ? (target[k] as unknown[]).slice() : [];
        for (const item of v.values) if (!arr.includes(item)) arr.push(item);
        target[k] = arr;
      }
    } else {
      target[k] = v;
    }
  }
}

export function createFirestoreMock(): MockFirestore {
  // Committed document store. Absence of a key => doc does not exist.
  const store = new Map<string, DocData>();
  // Explicit "non-existent" markers (setDoc(path, null)).
  const tombstones = new Set<string>();
  const queries = new Map<string, Array<{ id: string; data: DocData }>>();
  const writeOps: WriteOp[] = [];
  let autoId = 0;

  function snapFor(path: string): MockSnap {
    const ref = makeDocRef(path);
    const exists = store.has(path) && !tombstones.has(path);
    const raw = store.get(path);
    return {
      exists,
      id: path.split('/').pop()!,
      ref,
      data: () => (exists && raw ? { ...raw } : undefined),
    };
  }

  function commit(op: WriteOp): void {
    writeOps.push(op);
    if (op.method === 'delete') {
      store.delete(op.path);
      tombstones.add(op.path);
      return;
    }
    tombstones.delete(op.path);
    const existing = store.get(op.path) ?? {};
    const next = { ...existing };
    const mode =
      op.method === 'create'
        ? 'set'
        : op.method === 'set'
          ? op.merge
            ? 'merge'
            : 'set'
          : 'update';
    applyWrite(next, op.data, mode);
    store.set(op.path, next);
  }

  function makeDocRef(path: string): MockDocRef {
    return {
      path,
      id: path.split('/').pop()!,
      get: async () => snapFor(path),
      set: async (data, opts) => {
        commit({ method: 'set', path, data, merge: opts?.merge });
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

  interface WhereClause {
    field: string;
    op: string;
    value: unknown;
  }

  /**
   * Resolve the candidate docs for a collection query. Seeded docs (setQuery)
   * take priority — useful for fixing query results regardless of the live
   * store. If none are seeded, fall back to scanning the live store for docs
   * whose path is a direct child of the collection (so committed writes appear
   * in subsequent queries — required for idempotence tests).
   */
  function candidateDocs(collPath: string): Array<{ id: string; data: DocData }> {
    const seeded = queries.get(collPath);
    if (seeded) return seeded.map((d) => ({ id: d.id, data: { ...d.data } }));
    const out: Array<{ id: string; data: DocData }> = [];
    const prefix = `${collPath}/`;
    for (const [path, data] of store.entries()) {
      if (tombstones.has(path)) continue;
      const rest = path.slice(prefix.length);
      if (path.startsWith(prefix) && !rest.includes('/')) {
        out.push({ id: rest, data: { ...data } });
      }
    }
    return out;
  }

  /** Coerce Dates/Timestamps to a millisecond number for ordered comparisons. */
  function ord(v: unknown): number {
    if (v instanceof Date) return v.getTime();
    if (typeof v === 'object' && v !== null && typeof (v as { toMillis?: () => number }).toMillis === 'function') {
      return (v as { toMillis: () => number }).toMillis();
    }
    return v as number;
  }

  function matchesWhere(data: DocData, clauses: WhereClause[]): boolean {
    return clauses.every((c) => {
      if (c.op === '==') return data[c.field] === c.value;
      if (c.op === '<') return ord(data[c.field]) < ord(c.value);
      if (c.op === '<=') return ord(data[c.field]) <= ord(c.value);
      if (c.op === '>') return ord(data[c.field]) > ord(c.value);
      if (c.op === '>=') return ord(data[c.field]) >= ord(c.value);
      // Unknown op: don't filter it out.
      return true;
    });
  }

  function makeQuery(collPath: string, clauses: WhereClause[], lim: number | null): MockQuery {
    const q: MockQuery = {
      where: (...a: unknown[]) =>
        makeQuery(
          collPath,
          [...clauses, { field: a[0] as string, op: a[1] as string, value: a[2] }],
          lim
        ),
      orderBy: () => makeQuery(collPath, clauses, lim),
      limit: (...a: unknown[]) => makeQuery(collPath, clauses, a[0] as number),
      startAfter: () => makeQuery(collPath, clauses, lim),
      get: async () => {
        let docs = candidateDocs(collPath).filter((d) => matchesWhere(d.data, clauses));
        if (lim != null) docs = docs.slice(0, lim);
        const mapped = docs.map((d) => ({
          id: d.id,
          ref: makeDocRef(`${collPath}/${d.id}`),
          data: () => ({ ...d.data }),
        }));
        return { docs: mapped, empty: mapped.length === 0, size: mapped.length };
      },
    };
    return q;
  }

  function makeCollectionRef(path: string): MockCollectionRef {
    return {
      path,
      doc: (id?: string) => makeDocRef(`${path}/${id ?? `auto_${++autoId}`}`),
      add: async (data) => {
        const ref = makeDocRef(`${path}/auto_${++autoId}`);
        commit({ method: 'set', path: ref.path, data });
        return ref;
      },
      where: (...a: unknown[]) =>
        makeQuery(path, [{ field: a[0] as string, op: a[1] as string, value: a[2] }], null),
      orderBy: () => makeQuery(path, [], null),
      limit: (...a: unknown[]) => makeQuery(path, [], a[0] as number),
      get: async () => makeQuery(path, [], null).get(),
    };
  }

  function makeTransaction(): { tx: MockTransaction; flush: () => void } {
    // Stage writes; commit atomically when the callback resolves so reads inside
    // the same tx see pre-tx state (Firestore semantics).
    const staged: WriteOp[] = [];
    const tx: MockTransaction = {
      get: async (ref) => snapFor(ref.path),
      set: (ref, data, opts) =>
        void staged.push({ method: 'set', path: ref.path, data, merge: opts?.merge }),
      update: (ref, data) => void staged.push({ method: 'update', path: ref.path, data }),
      create: (ref, data) => void staged.push({ method: 'create', path: ref.path, data }),
      delete: (ref) => void staged.push({ method: 'delete', path: ref.path, data: {} }),
    };
    return { tx, flush: () => staged.forEach(commit) };
  }

  const db: MockDb = {
    collection: (name) => makeCollectionRef(name),
    runTransaction: async (fn) => {
      const { tx, flush } = makeTransaction();
      const result = await fn(tx);
      flush();
      return result;
    },
    batch: () => {
      const staged: WriteOp[] = [];
      const b: MockBatch = {
        set: (ref, data, opts) =>
          void staged.push({ method: 'set', path: ref.path, data, merge: opts?.merge }),
        update: (ref, data) => void staged.push({ method: 'update', path: ref.path, data }),
        delete: (ref) => void staged.push({ method: 'delete', path: ref.path, data: {} }),
        commit: async () => {
          staged.forEach(commit);
        },
      };
      return b;
    },
  };

  const FieldValue: MockFieldValue = {
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
      } else {
        tombstones.delete(path);
        store.set(path, { ...data });
      }
    },
    getDoc: (path) => {
      if (tombstones.has(path)) return undefined;
      const v = store.get(path);
      return v ? { ...v } : undefined;
    },
    setQuery: (path, docs) => {
      queries.set(
        path,
        docs.map((d) => ({ id: d.id, data: { ...d.data } }))
      );
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
          if (isSentinel(v) && v.__sentinel === 'increment') return sum + v.value;
          return sum;
        }, 0);
    },
    countWrites: (pred) => writeOps.filter(pred).length,
  };
}

/**
 * Build a Stripe mock whose method implementations are swappable per-test via
 * the returned `impl` registry. Methods used by the financial paths:
 *   - webhooks.constructEvent
 *   - refunds.create
 *   - paymentIntents.retrieve / cancel
 *   - transfers.create
 *   - payouts.create
 */
export interface StripeMockImpl {
  constructEvent: (...a: unknown[]) => unknown;
  refundsCreate: (...a: unknown[]) => unknown;
  paymentIntentsRetrieve: (...a: unknown[]) => unknown;
  paymentIntentsCancel: (...a: unknown[]) => unknown;
  transfersCreate: (...a: unknown[]) => unknown;
  payoutsCreate: (...a: unknown[]) => unknown;
}

export interface StripeMock {
  impl: StripeMockImpl;
  /** The object returned by the mocked getStripe(). */
  client: Record<string, unknown>;
  /** Calls captured per method (args arrays), for assertions. */
  calls: {
    refundsCreate: unknown[][];
    transfersCreate: unknown[][];
    payoutsCreate: unknown[][];
    paymentIntentsRetrieve: unknown[][];
    paymentIntentsCancel: unknown[][];
  };
  reset(): void;
}

export function createStripeMock(): StripeMock {
  const calls: StripeMock['calls'] = {
    refundsCreate: [],
    transfersCreate: [],
    payoutsCreate: [],
    paymentIntentsRetrieve: [],
    paymentIntentsCancel: [],
  };

  const impl: StripeMockImpl = {
    constructEvent: () => {
      throw new Error('constructEvent not stubbed for this test');
    },
    refundsCreate: async () => ({ id: 'rf_default' }),
    paymentIntentsRetrieve: async () => ({ status: 'requires_payment_method' }),
    paymentIntentsCancel: async () => ({ id: 'pi_cancelled' }),
    transfersCreate: async () => ({ id: 'tr_default' }),
    payoutsCreate: async () => ({ id: 'po_default' }),
  };

  const client: Record<string, unknown> = {
    webhooks: {
      constructEvent: (...a: unknown[]) => impl.constructEvent(...a),
    },
    refunds: {
      create: (...a: unknown[]) => {
        calls.refundsCreate.push(a);
        return impl.refundsCreate(...a);
      },
    },
    paymentIntents: {
      retrieve: (...a: unknown[]) => {
        calls.paymentIntentsRetrieve.push(a);
        return impl.paymentIntentsRetrieve(...a);
      },
      cancel: (...a: unknown[]) => {
        calls.paymentIntentsCancel.push(a);
        return impl.paymentIntentsCancel(...a);
      },
    },
    transfers: {
      create: (...a: unknown[]) => {
        calls.transfersCreate.push(a);
        return impl.transfersCreate(...a);
      },
    },
    payouts: {
      create: (...a: unknown[]) => {
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
