/**
 * Unit tests for the idempotent, double-spend-safe label creation helper
 * (F5/F82). createLabelIdempotent reserves the transaction (atomic) BEFORE the
 * paid ShipEngine call, so a webhook timeout / Stripe retry / concurrent sweep
 * can never create a SECOND paid label. These tests drive the helper directly
 * against the in-memory Firestore mock with a fake ShipEngine client.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFirestoreMock } from './testHelpers/firestoreMock';
import type { MockFirestore, WriteOp } from './testHelpers/firestoreMock';

const holder = vi.hoisted(() => ({
  fs: null as MockFirestore | null,
}));

const fs: MockFirestore = createFirestoreMock();
holder.fs = fs;

vi.mock('../config/firebase', () => ({
  get db() {
    return holder.fs!.db;
  },
  get FieldValue() {
    return holder.fs!.FieldValue;
  },
}));

// Minimal Timestamp stub: fromMillis(ms) -> instance with toMillis(). The
// reservation TTL guard uses `data.labelReservationAt instanceof Timestamp`, so
// fixtures that need to simulate a held reservation write a Timestamp instance.
// Defined via vi.hoisted so the (hoisted) vi.mock factory can reference it.
const { FakeTimestamp } = vi.hoisted(() => {
  class FakeTimestamp {
    constructor(public ms: number) {}
    static fromMillis(ms: number) {
      return new FakeTimestamp(ms);
    }
    toMillis() {
      return this.ms;
    }
  }
  return { FakeTimestamp };
});
vi.mock('firebase-admin/firestore', () => ({ Timestamp: FakeTimestamp }));

vi.mock('../config/stripe', () => ({
  getStripe: () => null,
}));

// wallet.ts (getOrCreateSellerWallet) registers onCall handlers at module load.
vi.mock('firebase-functions/v2/https', () => ({
  onCall: (_opts: unknown, handler: unknown) => handler,
  HttpsError: class extends Error {},
}));

vi.mock('firebase-functions/logger', () => ({
  info: () => {},
  error: () => {},
  warn: () => {},
  debug: () => {},
}));

import { createLabelIdempotent } from './labelFulfillment';

interface FakeShipEngine {
  createLabel: (rateId: string) => Promise<any>;
}

function makeLabel(id: string) {
  return {
    labelId: id,
    trackingNumber: `trk_${id}`,
    labelDownload: { href: `https://label/${id}` },
    trackingUrl: `https://track/${id}`,
    carrierCode: 'intelcom_ca',
    shipmentCost: 10,
    insuranceCost: 0,
  };
}

beforeEach(() => {
  fs.reset();
});

describe('createLabelIdempotent (F5/F82)', () => {
  it('creates the label once, credits the seller, persists the label, marks label_created', async () => {
    fs.setDoc('transactions/tx1', {
      sellerId: 'seller1',
      sellerPayout: 45,
      status: 'paid',
      shippingCost: 10,
      labelCreationPending: true,
    });
    fs.setDoc('wallets/seller1', { balance: 0, pendingBalance: 0, status: 'active' });

    let calls = 0;
    const shipEngine: FakeShipEngine = {
      createLabel: async (_rateId: string) => {
        calls++;
        return makeLabel('L1');
      },
    };

    const outcome = await createLabelIdempotent({
      transactionRef: fs.db.collection('transactions').doc('tx1') as never,
      transactionId: 'tx1',
      rateId: 'rate_1',
      shipEngine: shipEngine as never,
      estimatedShippingCost: 10,
    });

    expect(outcome).toBe('created');
    expect(calls).toBe(1);
    const tx = fs.getDoc('transactions/tx1')!;
    expect(tx.status).toBe('label_created');
    expect(tx.shipEngineLabelId).toBe('L1');
    expect(tx.trackingNumber).toBe('trk_L1');
    expect(tx.labelCreationPending).toBe(false);
    // Seller credited the payout in pendingBalance (deferred-credit at label).
    expect(fs.getDoc('wallets/seller1')!.pendingBalance).toBe(4500);
  });

  it('does NOT create a second paid label when a label already exists (idempotent)', async () => {
    fs.setDoc('transactions/tx2', {
      sellerId: 'seller1',
      sellerPayout: 45,
      status: 'label_created',
      shipEngineLabelId: 'EXISTING',
      shippingCost: 10,
    });
    fs.setDoc('wallets/seller1', { balance: 0, pendingBalance: 0, status: 'active' });

    let calls = 0;
    const shipEngine: FakeShipEngine = {
      createLabel: async () => {
        calls++;
        return makeLabel('L2');
      },
    };

    const outcome = await createLabelIdempotent({
      transactionRef: fs.db.collection('transactions').doc('tx2') as never,
      transactionId: 'tx2',
      rateId: 'rate_2',
      shipEngine: shipEngine as never,
      estimatedShippingCost: 10,
    });

    // Reservation refused (label already set) → no external call, no second label.
    expect(outcome).toBe('skip');
    expect(calls).toBe(0);
    expect(fs.getDoc('transactions/tx2')!.shipEngineLabelId).toBe('EXISTING');
  });

  it('backs off (skip, no createLabel) when a FRESH reservation is held by another run', async () => {
    fs.setDoc('transactions/tx3', {
      sellerId: 'seller1',
      sellerPayout: 45,
      status: 'paid',
      shippingCost: 10,
      // A concurrent run reserved 1 second ago — well within the 5-min TTL.
      labelReservationAt: FakeTimestamp.fromMillis(Date.now() - 1000),
    });
    fs.setDoc('wallets/seller1', { balance: 0, pendingBalance: 0, status: 'active' });

    let calls = 0;
    const shipEngine: FakeShipEngine = {
      createLabel: async () => {
        calls++;
        return makeLabel('L3');
      },
    };

    const outcome = await createLabelIdempotent({
      transactionRef: fs.db.collection('transactions').doc('tx3') as never,
      transactionId: 'tx3',
      rateId: 'rate_3',
      shipEngine: shipEngine as never,
      estimatedShippingCost: 10,
    });

    expect(outcome).toBe('skip');
    expect(calls).toBe(0); // never paid for a duplicate label
  });

  it('reclaims an EXPIRED reservation (crashed run) and creates the label', async () => {
    fs.setDoc('transactions/tx4', {
      sellerId: 'seller1',
      sellerPayout: 45,
      status: 'paid',
      shippingCost: 10,
      // Reservation 10 minutes ago — past the 5-min TTL, so reclaimable.
      labelReservationAt: FakeTimestamp.fromMillis(Date.now() - 10 * 60 * 1000),
    });
    fs.setDoc('wallets/seller1', { balance: 0, pendingBalance: 0, status: 'active' });

    const shipEngine: FakeShipEngine = {
      createLabel: async () => makeLabel('L4'),
    };

    const outcome = await createLabelIdempotent({
      transactionRef: fs.db.collection('transactions').doc('tx4') as never,
      transactionId: 'tx4',
      rateId: 'rate_4',
      shipEngine: shipEngine as never,
      estimatedShippingCost: 10,
    });

    expect(outcome).toBe('created');
    expect(fs.getDoc('transactions/tx4')!.shipEngineLabelId).toBe('L4');
  });

  it('clears the reservation on createLabel failure so a later run can retry', async () => {
    fs.setDoc('transactions/tx5', {
      sellerId: 'seller1',
      sellerPayout: 45,
      status: 'paid',
      shippingCost: 10,
    });
    fs.setDoc('wallets/seller1', { balance: 0, pendingBalance: 0, status: 'active' });

    const shipEngine: FakeShipEngine = {
      createLabel: async () => {
        throw new Error('ShipEngine 503');
      },
    };

    const outcome = await createLabelIdempotent({
      transactionRef: fs.db.collection('transactions').doc('tx5') as never,
      transactionId: 'tx5',
      rateId: 'rate_5',
      shipEngine: shipEngine as never,
      estimatedShippingCost: 10,
    });

    expect(outcome).toBe('failed');
    // Reservation cleared → the field is gone, so the next run can reserve again.
    expect(fs.getDoc('transactions/tx5')!.labelReservationAt).toBeUndefined();
    expect(fs.getDoc('transactions/tx5')!.shipEngineLabelId).toBeUndefined();
  });

  it('applies the applyExtraUpdate hook (e.g. shipEngineRateId on the sweep)', async () => {
    fs.setDoc('transactions/tx6', {
      sellerId: 'seller1',
      sellerPayout: 45,
      status: 'paid',
      shippingCost: 10,
      labelCreationNote: 'pending',
    });
    fs.setDoc('wallets/seller1', { balance: 0, pendingBalance: 0, status: 'active' });

    const shipEngine: FakeShipEngine = { createLabel: async () => makeLabel('L6') };

    const outcome = await createLabelIdempotent({
      transactionRef: fs.db.collection('transactions').doc('tx6') as never,
      transactionId: 'tx6',
      rateId: 'rate_6',
      shipEngine: shipEngine as never,
      estimatedShippingCost: 10,
      applyExtraUpdate: (_label, update) => {
        update.shipEngineRateId = 'rate_6';
        update.labelCreationNote = holder.fs!.FieldValue.delete();
      },
    });

    expect(outcome).toBe('created');
    const tx = fs.getDoc('transactions/tx6')!;
    expect(tx.shipEngineRateId).toBe('rate_6');
    expect(tx.labelCreationNote).toBeUndefined();
  });
});

// Silence unused-import lints for WriteOp in environments that tree-shake types.
export type _W = WriteOp;
