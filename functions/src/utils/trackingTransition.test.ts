/**
 * Regression tests for applyTrackingOutcome (F1: read-after-write in the
 * DELIVERED transition).
 *
 * The shared firestoreMock deliberately does NOT enforce the Admin SDK
 * "all reads before all writes" rule, so it cannot reproduce F1. Here we use a
 * STRICT transaction double that throws READ_AFTER_WRITE_ERROR the moment a
 * tx.get follows a buffered tx.update/tx.set — exactly like @google-cloud/
 * firestore. A correct DELIVERED transition (reads first) must commit without
 * throwing AND move the seller credit pendingBalance -> heldBalance.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Strict in-memory store + transaction that enforces read-after-write.
// ---------------------------------------------------------------------------
type Data = Record<string, any>;

const holder = vi.hoisted(() => ({
  store: new Map<string, Data>(),
  // ordered log of operations for assertions
  ops: [] as Array<{ kind: 'get' | 'update' | 'set'; path: string }>,
}));

function ref(path: string) {
  return {
    path,
    collection: (sub: string) => ({
      doc: (id?: string) => ref(`${path}/${sub}/${id ?? `auto_${holder.ops.length}`}`),
    }),
  };
}

class StrictTx {
  private wroteSomething = false;
  async get(r: { path: string }) {
    if (this.wroteSomething) {
      throw new Error(
        'Firestore transactions require all reads to be executed before all writes. (READ_AFTER_WRITE_ERROR)'
      );
    }
    holder.ops.push({ kind: 'get', path: r.path });
    const exists = holder.store.has(r.path);
    return {
      exists,
      data: () => (exists ? { ...holder.store.get(r.path)! } : undefined),
    };
  }
  update(r: { path: string }, data: Data) {
    this.wroteSomething = true;
    holder.ops.push({ kind: 'update', path: r.path });
    const prev = holder.store.get(r.path) ?? {};
    holder.store.set(r.path, applyIncrements(prev, data));
  }
  set(r: { path: string }, data: Data) {
    this.wroteSomething = true;
    holder.ops.push({ kind: 'set', path: r.path });
    holder.store.set(r.path, applyIncrements({}, data));
  }
}

function applyIncrements(prev: Data, patch: Data): Data {
  const next = { ...prev };
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === 'object' && (v as any).__inc !== undefined) {
      next[k] = (typeof next[k] === 'number' ? next[k] : 0) + (v as any).__inc;
    } else {
      next[k] = v;
    }
  }
  return next;
}

vi.mock('../config/firebase', () => ({
  db: {
    collection: (name: string) => ({ doc: (id: string) => ref(`${name}/${id}`) }),
    runTransaction: async (fn: (tx: StrictTx) => Promise<unknown>) => fn(new StrictTx()),
  },
  FieldValue: {
    serverTimestamp: () => ({ __ts: true }),
    increment: (n: number) => ({ __inc: n }),
  },
}));

vi.mock('../utils/notifications', () => ({
  sendPushNotification: () => Promise.resolve(),
}));

vi.mock('firebase-functions/logger', () => ({
  info: () => {},
  error: () => {},
  warn: () => {},
  debug: () => {},
}));

import { applyTrackingOutcome } from './trackingTransition';

beforeEach(() => {
  holder.store.clear();
  holder.ops.length = 0;
});

describe('applyTrackingOutcome — DELIVERED (F1 read-after-write)', () => {
  it('commits the delivery and moves credit pending -> held WITHOUT a read-after-write throw', async () => {
    holder.store.set('transactions/tx1', {
      status: 'shipped',
      sellerId: 'seller1',
      sellerPayout: 45,
      sellerCreditedCents: 4500,
      buyerId: 'buyer1',
      articleId: 'a',
      chatId: null,
    });
    holder.store.set('wallets/seller1', {
      pendingBalance: 4500,
      heldBalance: 0,
      balance: 0,
      status: 'active',
    });

    const result = await applyTrackingOutcome('tx1', 'DELIVERED', 'test');

    expect(result.kind).toBe('delivered');
    expect('changed' in result && result.changed).toBe(true);

    // Status advanced to delivered.
    expect(holder.store.get('transactions/tx1')!.status).toBe('delivered');
    // Held-funds contract applied (pending -> held).
    expect(holder.store.get('wallets/seller1')!.pendingBalance).toBe(0);
    expect(holder.store.get('wallets/seller1')!.heldBalance).toBe(4500);
    // fundsReleaseAt stamped on the transaction.
    expect(holder.store.get('transactions/tx1')!.fundsReleaseAt).toBeDefined();

    // The wallet read (wallets/seller1) happened BEFORE the first write.
    const firstWriteIdx = holder.ops.findIndex((o) => o.kind !== 'get');
    const walletGetIdx = holder.ops.findIndex(
      (o) => o.kind === 'get' && o.path === 'wallets/seller1'
    );
    expect(walletGetIdx).toBeGreaterThanOrEqual(0);
    expect(walletGetIdx).toBeLessThan(firstWriteIdx);
  });

  it('marks delivered but skips the held move when the seller was never credited', async () => {
    holder.store.set('transactions/tx_nocredit', {
      status: 'shipped',
      sellerId: 'seller1',
      sellerPayout: 45,
      // no sellerCreditedCents
      buyerId: 'buyer1',
    });
    holder.store.set('wallets/seller1', { pendingBalance: 0, heldBalance: 0, balance: 0 });

    const result = await applyTrackingOutcome('tx_nocredit', 'DELIVERED', 'test');

    expect(result.kind).toBe('delivered');
    expect(holder.store.get('transactions/tx_nocredit')!.status).toBe('delivered');
    // No held move (nothing was credited).
    expect(holder.store.get('wallets/seller1')!.heldBalance).toBe(0);
    // No wallet read at all (we never enter the credited branch).
    expect(holder.ops.some((o) => o.path === 'wallets/seller1')).toBe(false);
  });

  it('is a no-op on a non-deliverable status (already refunded)', async () => {
    holder.store.set('transactions/tx_ref', {
      status: 'refunded',
      sellerId: 'seller1',
      sellerCreditedCents: 4500,
    });
    holder.store.set('wallets/seller1', { pendingBalance: 0, heldBalance: 0, balance: 0 });

    const result = await applyTrackingOutcome('tx_ref', 'DELIVERED', 'test');

    expect('changed' in result && result.changed).toBe(false);
    expect(holder.store.get('transactions/tx_ref')!.status).toBe('refunded');
    expect(holder.store.get('wallets/seller1')!.heldBalance).toBe(0);
  });
});
