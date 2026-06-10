/**
 * Tests for retryFailedOperations dead-letter replay (F77 + F85).
 *
 *  - F77: a 'lost_pi_succeeded_webhook' dead-letter is auto-replayed by re-driving
 *    the canonical PI.succeeded handler (redrivePaymentIntentSucceeded). On a
 *    successful re-drive the op is marked 'resolved'.
 *  - F85: when an op exhausts MAX_ATTEMPTS, a critical admin_alert is written in
 *    addition to the CRITICAL log.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFirestoreMock, createStripeMock } from '../utils/testHelpers/firestoreMock';
import type { MockFirestore, StripeMock, WriteOp } from '../utils/testHelpers/firestoreMock';

const holder = vi.hoisted(() => ({
  fs: null as MockFirestore | null,
  stripe: null as StripeMock | null,
  redriveResult: true,
  redriveCalls: [] as string[],
}));

const fs: MockFirestore = createFirestoreMock();
const stripeMock: StripeMock = createStripeMock();
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

// Mock the webhook re-drive so we don't pull the whole webhook module graph.
vi.mock('../http/webhooks', () => ({
  redrivePaymentIntentSucceeded: async (pi: string) => {
    holder.redriveCalls.push(pi);
    return holder.redriveResult;
  },
}));

vi.mock('../utils/payoutRecovery', () => ({
  revertFailedPayout: async () => ({ reCredited: true, transferId: null }),
}));

vi.mock('firebase-functions/logger', () => ({
  info: () => {},
  error: () => {},
  warn: () => {},
  debug: () => {},
}));

vi.mock('firebase-functions/v2/scheduler', () => ({
  onSchedule: (_opts: unknown, handler: unknown) => handler,
}));

import { retryFailedOperations } from './retryFailedOperations';

type Scheduled = () => Promise<void>;
const run = retryFailedOperations as unknown as Scheduled;

beforeEach(() => {
  fs.reset();
  stripeMock.reset();
  holder.redriveResult = true;
  holder.redriveCalls.length = 0;
});

describe('retryFailedOperations — lost PI.succeeded replay (F77)', () => {
  it('re-drives a lost_pi_succeeded_webhook op and marks it resolved', async () => {
    fs.setDoc('failed_operations/op1', {
      type: 'amount_mismatch',
      refId: 'tx1',
      payload: { kind: 'lost_pi_succeeded_webhook', paymentIntentId: 'pi_lost' },
      attempts: 0,
      status: 'pending',
      lastTriedAt: null,
    });

    await run();

    // The canonical PI.succeeded handler was re-driven with the persisted PI id.
    expect(holder.redriveCalls).toEqual(['pi_lost']);
    expect(fs.getDoc('failed_operations/op1')!.status).toBe('resolved');
  });

  it('keeps the op pending when the re-drive reports the PI is not (yet) succeeded', async () => {
    holder.redriveResult = false;
    fs.setDoc('failed_operations/op2', {
      type: 'amount_mismatch',
      refId: 'tx2',
      payload: { kind: 'lost_pi_succeeded_webhook', paymentIntentId: 'pi_pending' },
      attempts: 0,
      status: 'pending',
      lastTriedAt: null,
    });

    await run();

    expect(holder.redriveCalls).toEqual(['pi_pending']);
    // Not resolved — bumped attempts, still pending (will retry).
    expect(fs.getDoc('failed_operations/op2')!.status).toBe('pending');
    expect(fs.getDoc('failed_operations/op2')!.attempts).toBe(1);
  });
});

describe('retryFailedOperations — exhaustion alert (F85)', () => {
  it('writes a critical admin_alert when an op exhausts MAX_ATTEMPTS', async () => {
    // An unknown type always returns 'retry'; seed it at attempts=5 so the next
    // (6th) attempt exhausts it.
    fs.setDoc('failed_operations/op_exhaust', {
      type: 'some_unknown_type',
      refId: 'ref_x',
      payload: {},
      attempts: 5, // MAX_ATTEMPTS = 6
      status: 'pending',
      lastTriedAt: null,
    });

    await run();

    expect(fs.getDoc('failed_operations/op_exhaust')!.status).toBe('exhausted');
    const alert = fs.writeOps.find(
      (op: WriteOp) =>
        op.path.startsWith('admin_alerts/') && op.data.kind === 'dead_letter_exhausted'
    );
    expect(alert).toBeDefined();
    expect(alert!.data.severity).toBe('critical');
  });
});
