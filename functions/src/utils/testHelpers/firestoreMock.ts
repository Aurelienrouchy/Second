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
export interface ArrayRemoveSentinel {
  __sentinel: 'arrayRemove';
  values: unknown[];
}
export interface DeleteSentinel {
  __sentinel: 'delete';
}

type Sentinel =
  | IncrementSentinel
  | ServerTimestampSentinel
  | ArrayUnionSentinel
  | DeleteSentinel
  | ArrayRemoveSentinel;

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
  doc(path: string): MockDocRef;
  collection(name: string): MockCollectionRef;
  collectionGroup(name: string): MockQuery;
  runTransaction<T>(fn: (tx: MockTransaction) => Promise<T>): Promise<T>;
  batch(): MockBatch;
  bulkWriter(): MockBulkWriter;
}

interface MockFieldValue {
  serverTimestamp(): ServerTimestampSentinel;
  increment(n: number): IncrementSentinel;
  arrayUnion(...args: unknown[]): ArrayUnionSentinel;
  arrayRemove(...args: unknown[]): ArrayRemoveSentinel;
  delete(): DeleteSentinel;
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
  select(...fields: string[]): MockQuery;
  get(): Promise<MockQuerySnap>;
}

interface OrderClause {
  field: string;
  dir: 'asc' | 'desc';
}

interface MockQuery {
  where(...a: unknown[]): MockQuery;
  orderBy(...a: unknown[]): MockQuery;
  limit(...a: unknown[]): MockQuery;
  startAfter(...a: unknown[]): MockQuery;
  select(...fields: string[]): MockQuery;
  get(): Promise<MockQuerySnap>;
  count(): MockAggregateQuery;
}

interface MockAggregateQuery {
  get(): Promise<{ data(): { count: number } }>;
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
  /**
   * L'Admin SDK accepte une référence de document OU une REQUÊTE
   * (`tx.get(query)`), qui est la façon correcte de lire une collection dans une
   * transaction : la lecture entre alors dans l'ensemble de lecture et déclenche
   * une reprise en cas d'écriture concurrente. Le mock ne connaissait que la
   * référence, donc tout code migré vers `tx.get(query)` cassait ici.
   */
  get(ref: MockDocRef): Promise<MockSnap>;
  get(query: MockQuery): Promise<MockQuerySnap>;
  getAll(...refs: MockDocRef[]): Promise<MockSnap[]>;
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

interface MockBulkWriter {
  set(ref: MockDocRef, data: DocData, opts?: { merge?: boolean }): void;
  update(ref: MockDocRef, data: DocData): void;
  delete(ref: MockDocRef): void;
  close(): Promise<void>;
}

/**
 * Apply a write (with sentinel resolution) onto a target document object,
 * mutating it in place. Mirrors Firestore semantics for increment/serverTimestamp.
 */
/**
 * Résout une clé de champ vers le conteneur qui la porte.
 *
 * Firestore n'interprète la notation pointée QUE dans `update()` : là,
 * `{ 'offer.status': 'expired' }` écrit le champ imbriqué `status` dans la map
 * `offer` sans toucher au reste de la map. Dans `set()` (avec ou sans merge),
 * la même clé est un nom de champ LITTÉRAL contenant un point.
 *
 * Sans cette distinction, le mock rangeait `'offer.status'` comme clé de premier
 * niveau : un test lisant `doc.offer.status` voyait l'ancienne valeur et passait
 * au vert sur du code qui, en production, avait bien écrit — ou l'inverse.
 */
function resolveFieldPath(
  target: DocData,
  key: string,
  interpretDots: boolean
): { container: DocData; leaf: string } {
  if (!interpretDots || !key.includes('.')) return { container: target, leaf: key };
  const parts = key.split('.');
  const leaf = parts.pop()!;
  let container = target;
  for (const part of parts) {
    const next = container[part];
    if (typeof next !== 'object' || next === null || Array.isArray(next)) {
      container[part] = {};
    }
    container = container[part] as DocData;
  }
  return { container, leaf };
}

function applyWrite(
  target: DocData,
  data: DocData,
  mode: 'set' | 'update' | 'merge'
): void {
  if (mode === 'set') {
    // Overwrite: clear existing keys first.
    for (const k of Object.keys(target)) delete target[k];
  }
  const interpretDots = mode === 'update';
  for (const [rawKey, v] of Object.entries(data)) {
    const { container: target_, leaf: k } = resolveFieldPath(target, rawKey, interpretDots);
    applyField(target_, k, v);
  }
}

function applyField(target: DocData, k: string, v: unknown): void {
  {
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
      } else if (v.__sentinel === 'arrayRemove') {
        const arr = Array.isArray(target[k]) ? (target[k] as unknown[]) : [];
        target[k] = arr.filter((item) => !v.values.includes(item));
      } else if (v.__sentinel === 'delete') {
        delete target[k];
      }
    } else {
      target[k] = v;
    }
    // Preserve flat operation keys for existing assertions and expose real
    // nested Firestore state for replay/transition tests.
    if (k.includes('.')) {
      const parts = k.split('.');
      let nested = target;
      for (const part of parts.slice(0, -1)) {
        nested[part] = { ...((nested[part] as DocData | undefined) ?? {}) };
        nested = nested[part] as DocData;
      }
      const leaf = parts[parts.length - 1];
      if (isSentinel(v) && v.__sentinel === 'delete') delete nested[leaf];
      else nested[leaf] = target[k];
    }
  }
}

export function createFirestoreMock(options: { enforceReadBeforeWrite?: boolean } = {}): MockFirestore {
  // Committed document store. Absence of a key => doc does not exist.
  const store = new Map<string, DocData>();
  // Explicit "non-existent" markers (setDoc(path, null)).
  const tombstones = new Set<string>();
  const queries = new Map<string, Array<{ id: string; data: DocData }>>();
  const writeOps: WriteOp[] = [];
  let transactionQueue: Promise<unknown> = Promise.resolve();
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

  /**
   * Documents d'un GROUPE de collection : tous les `…/<name>/<id>`, à
   * n'importe quelle profondeur. Le chemin complet est conservé, les tâches
   * planifiées en tirant l'identifiant du propriétaire (`users/{uid}/…`).
   */
  function candidateGroupDocs(name: string): Array<{ id: string; path: string; data: DocData }> {
    const out: Array<{ id: string; path: string; data: DocData }> = [];
    for (const [path, data] of store.entries()) {
      if (tombstones.has(path)) continue;
      const segments = path.split('/');
      if (segments.length >= 2 && segments[segments.length - 2] === name) {
        out.push({ id: segments[segments.length - 1], path, data: { ...data } });
      }
    }
    return out;
  }

  function makeGroupQuery(
    name: string,
    clauses: WhereClause[],
    lim: number | null,
    orders: OrderClause[] = []
  ): MockQuery {
    const q: MockQuery = {
      count: () => ({ get: async () => { const snapshot = await q.get(); return { data: () => ({ count: snapshot.size }) }; } }),
      where: (...a: unknown[]) =>
        makeGroupQuery(
          name,
          [...clauses, { field: a[0] as string, op: a[1] as string, value: a[2] }],
          lim,
          orders
        ),
      orderBy: (...a: unknown[]) =>
        makeGroupQuery(name, clauses, lim, [
          ...orders,
          { field: a[0] as string, dir: (a[1] as string) === 'desc' ? 'desc' : 'asc' },
        ]),
      limit: (...a: unknown[]) => makeGroupQuery(name, clauses, a[0] as number, orders),
      startAfter: () => makeGroupQuery(name, clauses, lim, orders),
      select: () => makeGroupQuery(name, clauses, lim, orders),
      get: async () => {
        let docs = candidateGroupDocs(name).filter((d) => matchesWhere(d.data, clauses));
        const ordered = applyOrders(
          docs.map((d) => ({ id: d.id, data: d.data })),
          orders
        );
        const byId = new Map(docs.map((d) => [d.id, d]));
        docs = ordered.map((d) => byId.get(d.id)!).filter(Boolean);
        if (lim != null) docs = docs.slice(0, lim);
        const mapped = docs.map((d) => ({
          id: d.id,
          exists: true,
          ref: makeDocRef(d.path),
          data: () => ({ ...d.data }),
        }));
        return { docs: mapped, empty: mapped.length === 0, size: mapped.length };
      },
    };
    return q;
  }

  /** Coerce Dates/Timestamps to a millisecond number for ordered comparisons. */
  function ord(v: unknown): number {
    if (v instanceof Date) return v.getTime();
    if (typeof v === 'object' && v !== null && typeof (v as { toMillis?: () => number }).toMillis === 'function') {
      return (v as { toMillis: () => number }).toMillis();
    }
    return v as number;
  }

  /**
   * Lit un champ en suivant la notation pointée, comme le fait le moteur de
   * requêtes Firestore : `where('offer.status','==',…)` interroge le champ
   * imbriqué `status` de la map `offer`, PAS une clé de premier niveau nommée
   * « offer.status ».
   *
   * On retombe sur la clé littérale si le chemin ne résout pas, pour ne pas
   * casser un document semé à plat.
   */
  function readField(data: DocData, field: string): unknown {
    if (!field.includes('.')) return data[field];
    let cur: unknown = data;
    for (const part of field.split('.')) {
      if (typeof cur !== 'object' || cur === null) return data[field];
      cur = (cur as DocData)[part];
    }
    return cur !== undefined ? cur : data[field];
  }

  function matchesWhere(data: DocData, clauses: WhereClause[]): boolean {
    return clauses.every((c) => {
      const v = readField(data, c.field);
      if (c.op === '==') return v === c.value;
      if (c.op === '<') return ord(v) < ord(c.value);
      if (c.op === '<=') return ord(v) <= ord(c.value);
      if (c.op === '>') return ord(v) > ord(c.value);
      if (c.op === '>=') return ord(v) >= ord(c.value);
      // `in` / `not-in` / `array-contains*` étaient absents : l'opérateur
      // inconnu retombait sur `return true`, donc un `where(x,'in',[…])` ne
      // filtrait RIEN et rendait tous les documents de la collection. Des tests
      // passaient à vide sur ce terrain.
      if (c.op === 'in') return Array.isArray(c.value) && c.value.includes(v as never);
      if (c.op === 'not-in') return Array.isArray(c.value) && !c.value.includes(v as never);
      if (c.op === 'array-contains') return Array.isArray(v) && v.includes(c.value as never);
      if (c.op === 'array-contains-any') {
        return (
          Array.isArray(v) &&
          Array.isArray(c.value) &&
          c.value.some((needle) => (v as unknown[]).includes(needle))
        );
      }
      if (c.op === '!=') return v !== c.value;
      // Unknown op: don't filter it out.
      return true;
    });
  }

  // `select` projette comme Firestore : seuls les champs nommés reviennent,
  // un champ absent du document reste absent. Sans projection, le document
  // entier.
  function project(data: DocData, fields: string[] | null): DocData {
    if (!fields) return { ...data };
    const out: DocData = {};
    for (const f of fields) if (f in data) out[f] = data[f];
    return out;
  }

  /**
   * `orderBy` était un no-op : le bouchon rendait les documents dans l'ordre
   * d'insertion, si bien qu'un tri manquant dans le code de production passait
   * inaperçu (SS01 : les cinquante PLUS ANCIENNES notifications au lieu des
   * plus récentes). Il trie désormais, avant d'appliquer la limite.
   */
  function sortValue(value: unknown): number | string {
    if (value == null) return '';
    if (typeof value === 'number' || typeof value === 'string') return value;
    if (value instanceof Date) return value.getTime();
    const ts = value as { toMillis?: () => number };
    if (typeof ts.toMillis === 'function') return ts.toMillis();
    return String(value);
  }

  function applyOrders(
    docs: Array<{ id: string; data: DocData }>,
    orders: OrderClause[]
  ): Array<{ id: string; data: DocData }> {
    if (orders.length === 0) return docs;
    return [...docs].sort((a, b) => {
      for (const { field, dir } of orders) {
        const va = sortValue(field === '__name__' ? a.id : a.data[field]);
        const vb = sortValue(field === '__name__' ? b.id : b.data[field]);
        if (va < vb) return dir === 'desc' ? 1 : -1;
        if (va > vb) return dir === 'desc' ? -1 : 1;
      }
      return 0;
    });
  }

  function makeQuery(
    collPath: string,
    clauses: WhereClause[],
    lim: number | null,
    fields: string[] | null = null,
    orders: OrderClause[] = [],
    afterId: string | null = null
  ): MockQuery {
    const q: MockQuery = {
      count: () => ({ get: async () => { const snapshot = await q.get(); return { data: () => ({ count: snapshot.size }) }; } }),
      where: (...a: unknown[]) =>
        makeQuery(
          collPath,
          [...clauses, { field: a[0] as string, op: a[1] as string, value: a[2] }],
          lim,
          fields,
          orders,
          afterId
        ),
      orderBy: (...a: unknown[]) =>
        makeQuery(collPath, clauses, lim, fields, [
          ...orders,
          { field: a[0] as string, dir: (a[1] as string) === 'desc' ? 'desc' : 'asc' },
        ], afterId),
      limit: (...a: unknown[]) => makeQuery(collPath, clauses, a[0] as number, fields, orders, afterId),
      startAfter: (...a: unknown[]) => makeQuery(collPath, clauses, lim, fields, orders,
        orders[0]?.field === '__name__' ? (typeof a[0] === 'string' ? a[0] : (a[0] as { id: string }).id) : afterId),
      select: (...f: string[]) => makeQuery(collPath, clauses, lim, f, orders, afterId),
      get: async () => {
        let docs = candidateDocs(collPath).filter((d) => matchesWhere(d.data, clauses));
        docs = applyOrders(docs, orders);
        if (afterId != null) docs = docs.filter(d => orders[0]?.dir === 'desc' ? d.id < afterId : d.id > afterId);
        if (lim != null) docs = docs.slice(0, lim);
        const mapped = docs.map((d) => ({
          id: d.id,
          exists: true,
          ref: makeDocRef(`${collPath}/${d.id}`),
          data: () => project(d.data, fields),
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
      orderBy: (...a: unknown[]) =>
        makeQuery(path, [], null, null, [
          { field: a[0] as string, dir: (a[1] as string) === 'desc' ? 'desc' : 'asc' },
        ]),
      limit: (...a: unknown[]) => makeQuery(path, [], a[0] as number),
      select: (...f: string[]) => makeQuery(path, [], null, f),
      get: async () => makeQuery(path, [], null).get(),
    };
  }

  function makeTransaction(): { tx: MockTransaction; flush: () => void } {
    // Stage writes; commit atomically when the callback resolves so reads inside
    // the same tx see pre-tx state (Firestore semantics).
    const staged: WriteOp[] = [];
    const tx: MockTransaction = {
      get: (async (target: MockDocRef | MockQuery) => {
        if (options.enforceReadBeforeWrite && staged.length > 0) throw new Error('Firestore transactions require all reads before writes');
        // Une requête n'a pas de `path` : on la distingue à sa méthode `where`.
        if (!('path' in target) && typeof (target as MockQuery).get === 'function') {
          return (target as MockQuery).get();
        }
        return snapFor((target as MockDocRef).path);
      }) as MockTransaction['get'],
      getAll: (...refs) => Promise.all(refs.map(ref => tx.get(ref))),
      set: (ref, data, opts) =>
        void staged.push({ method: 'set', path: ref.path, data, merge: opts?.merge }),
      update: (ref, data) => void staged.push({ method: 'update', path: ref.path, data }),
      create: (ref, data) => void staged.push({ method: 'create', path: ref.path, data }),
      delete: (ref) => void staged.push({ method: 'delete', path: ref.path, data: {} }),
    };
    return { tx, flush: () => staged.forEach(commit) };
  }

  const db: MockDb = {
    doc: (path) => makeDocRef(path),
    collection: (name) => makeCollectionRef(name),
    collectionGroup: (name: string) => makeGroupQuery(name, [], null),
    runTransaction: async (fn) => {
      const run = transactionQueue.then(async () => {
        const { tx, flush } = makeTransaction();
        const result = await fn(tx);
        flush();
        return result;
      });
      transactionQueue = run.catch(() => undefined);
      return run;
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
    bulkWriter: () => {
      // BulkWriter commits each write as it is enqueued (best-effort, no atomic
      // batching) — close() is the flush point. We commit eagerly so subsequent
      // reads in the same run observe the writes.
      const w: MockBulkWriter = {
        set: (ref, data, opts) =>
          commit({ method: 'set', path: ref.path, data, merge: opts?.merge }),
        update: (ref, data) => commit({ method: 'update', path: ref.path, data }),
        delete: (ref) => commit({ method: 'delete', path: ref.path, data: {} }),
        close: async () => {},
      };
      return w;
    },
  };

  const FieldValue: MockFieldValue = {
    serverTimestamp: () => ({ __sentinel: 'serverTimestamp' }),
    increment: (n) => ({ __sentinel: 'increment', value: n }),
    arrayUnion: (...args) => ({ __sentinel: 'arrayUnion', values: args }),
    arrayRemove: (...args) => ({ __sentinel: 'arrayRemove', values: args }),
    delete: () => ({ __sentinel: 'delete' }),
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
  refundsRetrieve: (...a: unknown[]) => unknown;
  refundsList: (...a: unknown[]) => unknown;
  paymentIntentsCreate: (...a: unknown[]) => unknown;
  paymentIntentsRetrieve: (...a: unknown[]) => unknown;
  paymentIntentsCancel: (...a: unknown[]) => unknown;
  chargesRetrieve: (...a: unknown[]) => unknown;
  transfersCreate: (...a: unknown[]) => unknown;
  transfersCreateReversal: (...a: unknown[]) => unknown;
  payoutsCreate: (...a: unknown[]) => unknown;
  payoutsRetrieve: (...a: unknown[]) => unknown;
  payoutsList: (...a: unknown[]) => unknown;
  accountsRetrieve: (...a: unknown[]) => unknown;
  accountsUpdate: (...a: unknown[]) => unknown;
  accountsCreateExternalAccount: (...a: unknown[]) => unknown;
  accountsListExternalAccounts: (...a: unknown[]) => unknown;
  accountsDeleteExternalAccount: (...a: unknown[]) => unknown;
  filesCreate: (...a: unknown[]) => unknown;
}

export interface StripeMock {
  impl: StripeMockImpl;
  /** The object returned by the mocked getStripe(). */
  client: Record<string, unknown>;
  /** Calls captured per method (args arrays), for assertions. */
  calls: {
    refundsCreate: unknown[][];
    refundsRetrieve: unknown[][];
    refundsList: unknown[][];
    transfersCreate: unknown[][];
    transfersCreateReversal: unknown[][];
    payoutsCreate: unknown[][];
    payoutsRetrieve: unknown[][];
    payoutsList: unknown[][];
    paymentIntentsCreate: unknown[][];
    paymentIntentsRetrieve: unknown[][];
    paymentIntentsCancel: unknown[][];
    chargesRetrieve: unknown[][];
    accountsRetrieve: unknown[][];
    accountsUpdate: unknown[][];
    accountsCreateExternalAccount: unknown[][];
    accountsListExternalAccounts: unknown[][];
    accountsDeleteExternalAccount: unknown[][];
    filesCreate: unknown[][];
  };
  reset(): void;
}

export function createStripeMock(): StripeMock {
  const calls: StripeMock['calls'] = {
    refundsCreate: [],
    refundsRetrieve: [],
    refundsList: [],
    transfersCreate: [],
    transfersCreateReversal: [],
    payoutsCreate: [],
    payoutsRetrieve: [],
    payoutsList: [],
    paymentIntentsCreate: [],
    paymentIntentsRetrieve: [],
    paymentIntentsCancel: [],
    chargesRetrieve: [],
    accountsRetrieve: [],
    accountsUpdate: [],
    accountsCreateExternalAccount: [],
    accountsListExternalAccounts: [],
    accountsDeleteExternalAccount: [],
    filesCreate: [],
  };

  const refundStore = new Map<string, any>();
  const defaultCreate = async (params: any) => ({ id: 'rf_default', status: 'succeeded', currency: 'cad',
    payment_intent: params.payment_intent, amount: params.amount ?? 0, metadata: params.metadata ?? {} });
  const defaultRetrieve = async (id: any) => {
    const found = refundStore.get(id);
    if (!found) throw new Error('Refund not found in simulated provider');
    return { ...found };
  };
  const defaultList = async (params: any) => ({ data: [...refundStore.values()].filter(r => r.payment_intent === params.payment_intent), has_more: false });
  const impl: StripeMockImpl = {
    constructEvent: () => {
      throw new Error('constructEvent not stubbed for this test');
    },
    refundsCreate: defaultCreate,
    refundsRetrieve: defaultRetrieve,
    refundsList: defaultList,
    paymentIntentsCreate: async () => ({ id: 'pi_default', client_secret: 'pi_default_secret' }),
    paymentIntentsRetrieve: async () => ({ status: 'requires_payment_method' }),
    paymentIntentsCancel: async () => ({ id: 'pi_cancelled' }),
    chargesRetrieve: async () => ({ id: 'ch_default', balance_transaction: { fee: 0 } }),
    transfersCreate: async () => ({ id: 'tr_default' }),
    transfersCreateReversal: async () => ({ id: 'trr_default' }),
    payoutsCreate: async () => ({ id: 'po_default' }),
    payoutsRetrieve: async () => ({ id: 'po_default', status: 'pending' }),
    payoutsList: async () => ({ data: [], has_more: false }),
    accountsRetrieve: async () => ({ id: 'acct_default', charges_enabled: true, payouts_enabled: true, details_submitted: true }),
    accountsUpdate: async () => ({ id: 'acct_default' }),
    accountsCreateExternalAccount: async () => ({ id: 'ba_default', last4: '0000', status: 'new' }),
    accountsListExternalAccounts: async () => ({ data: [] }),
    accountsDeleteExternalAccount: async () => ({ id: 'ba_default', deleted: true }),
    filesCreate: async () => ({ id: 'file_default' }),
  };

  const client: Record<string, unknown> = {
    webhooks: {
      constructEvent: (...a: unknown[]) => impl.constructEvent(...a),
    },
    refunds: {
      create: async (...a: unknown[]) => {
        calls.refundsCreate.push(a);
        const result: any = await impl.refundsCreate(...a);
        if (result?.id) refundStore.set(result.id, { ...result });
        return result;
      },
      retrieve: (...a: unknown[]) => { calls.refundsRetrieve.push(a); return impl.refundsRetrieve(...a); },
      list: (...a: unknown[]) => { calls.refundsList.push(a); return impl.refundsList(...a); },
    },
    paymentIntents: {
      create: (...a: unknown[]) => {
        calls.paymentIntentsCreate.push(a);
        return impl.paymentIntentsCreate(...a);
      },
      retrieve: (...a: unknown[]) => {
        calls.paymentIntentsRetrieve.push(a);
        return impl.paymentIntentsRetrieve(...a);
      },
      cancel: (...a: unknown[]) => {
        calls.paymentIntentsCancel.push(a);
        return impl.paymentIntentsCancel(...a);
      },
    },
    charges: {
      retrieve: (...a: unknown[]) => {
        calls.chargesRetrieve.push(a);
        return impl.chargesRetrieve(...a);
      },
    },
    transfers: {
      create: (...a: unknown[]) => {
        calls.transfersCreate.push(a);
        return impl.transfersCreate(...a);
      },
      createReversal: (...a: unknown[]) => {
        calls.transfersCreateReversal.push(a);
        return impl.transfersCreateReversal(...a);
      },
    },
    payouts: {
      list: (...a: unknown[]) => {
        calls.payoutsList.push(a);
        return impl.payoutsList(...a);
      },
      create: (...a: unknown[]) => {
        calls.payoutsCreate.push(a);
        return impl.payoutsCreate(...a);
      },
      retrieve: (...a: unknown[]) => {
        calls.payoutsRetrieve.push(a);
        return impl.payoutsRetrieve(...a);
      },
    },
    accounts: {
      retrieve: (...a: unknown[]) => {
        calls.accountsRetrieve.push(a);
        return impl.accountsRetrieve(...a);
      },
      update: (...a: unknown[]) => {
        calls.accountsUpdate.push(a);
        return impl.accountsUpdate(...a);
      },
      createExternalAccount: (...a: unknown[]) => {
        calls.accountsCreateExternalAccount.push(a);
        return impl.accountsCreateExternalAccount(...a);
      },
      listExternalAccounts: (...a: unknown[]) => {
        calls.accountsListExternalAccounts.push(a);
        return impl.accountsListExternalAccounts(...a);
      },
      deleteExternalAccount: (...a: unknown[]) => {
        calls.accountsDeleteExternalAccount.push(a);
        return impl.accountsDeleteExternalAccount(...a);
      },
    },
    files: {
      create: (...a: unknown[]) => {
        calls.filesCreate.push(a);
        return impl.filesCreate(...a);
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
      refundStore.clear();
      impl.refundsCreate = defaultCreate;
      impl.refundsRetrieve = defaultRetrieve;
      impl.refundsList = defaultList;
      impl.paymentIntentsCreate = async () => ({ id: 'pi_default', client_secret: 'pi_default_secret' });
      impl.paymentIntentsRetrieve = async () => ({ status: 'requires_payment_method' });
      impl.paymentIntentsCancel = async () => ({ id: 'pi_cancelled' });
      impl.chargesRetrieve = async () => ({ id: 'ch_default', balance_transaction: { fee: 0 } });
      impl.transfersCreate = async () => ({ id: 'tr_default' });
      impl.transfersCreateReversal = async () => ({ id: 'trr_default' });
      impl.payoutsCreate = async () => ({ id: 'po_default' });
      impl.payoutsRetrieve = async () => ({ id: 'po_default', status: 'pending' });
      impl.payoutsList = async () => ({ data: [], has_more: false });
      impl.accountsRetrieve = async () => ({ id: 'acct_default', charges_enabled: true, payouts_enabled: true, details_submitted: true });
      impl.accountsUpdate = async () => ({ id: 'acct_default' });
      impl.accountsCreateExternalAccount = async () => ({ id: 'ba_default', last4: '0000', status: 'new' });
      impl.accountsListExternalAccounts = async () => ({ data: [] });
      impl.accountsDeleteExternalAccount = async () => ({ id: 'ba_default', deleted: true });
      impl.filesCreate = async () => ({ id: 'file_default' });
      calls.refundsCreate.length = 0;
      calls.refundsRetrieve.length = 0;
      calls.refundsList.length = 0;
      calls.transfersCreate.length = 0;
      calls.transfersCreateReversal.length = 0;
      calls.payoutsCreate.length = 0;
      calls.payoutsRetrieve.length = 0;
      calls.payoutsList.length = 0;
      calls.paymentIntentsCreate.length = 0;
      calls.paymentIntentsRetrieve.length = 0;
      calls.paymentIntentsCancel.length = 0;
      calls.chargesRetrieve.length = 0;
      calls.accountsRetrieve.length = 0;
      calls.accountsUpdate.length = 0;
      calls.accountsCreateExternalAccount.length = 0;
      calls.accountsListExternalAccounts.length = 0;
      calls.accountsDeleteExternalAccount.length = 0;
      calls.filesCreate.length = 0;
    },
  };
}
