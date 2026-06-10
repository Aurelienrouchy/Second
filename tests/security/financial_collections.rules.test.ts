import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

import { getTestEnv, teardownTestEnv } from './helpers';

const ALICE = 'alice'; // buyer
const BOB = 'bob'; // seller
const CHARLIE = 'charlie'; // third party

// disputes — buyer-opened "delivered but problem" tickets. Creation, status
// changes and resolution are CF-owned so the linked transaction freeze stays
// authoritative. Parties may READ; nobody may write client-side.
describe('disputes rules (F114)', () => {
  beforeAll(async () => {
    await getTestEnv();
  });

  afterAll(async () => {
    await teardownTestEnv();
  });

  beforeEach(async () => {
    const env = await getTestEnv();
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'disputes', 'dispute-1'), {
        transactionId: 'tx-1',
        buyerId: ALICE,
        sellerId: BOB,
        status: 'open',
      });
    });
  });

  it('allows the buyer to read their dispute', async () => {
    const db = (await getTestEnv()).authenticatedContext(ALICE).firestore();
    await assertSucceeds(getDoc(doc(db, 'disputes', 'dispute-1')));
  });

  it('allows the seller to read the dispute', async () => {
    const db = (await getTestEnv()).authenticatedContext(BOB).firestore();
    await assertSucceeds(getDoc(doc(db, 'disputes', 'dispute-1')));
  });

  it('denies a third party reading the dispute', async () => {
    const db = (await getTestEnv()).authenticatedContext(CHARLIE).firestore();
    await assertFails(getDoc(doc(db, 'disputes', 'dispute-1')));
  });

  it('denies a client creating a dispute (CF-only)', async () => {
    const db = (await getTestEnv()).authenticatedContext(ALICE).firestore();
    await assertFails(
      setDoc(doc(db, 'disputes', 'dispute-hacker'), {
        transactionId: 'tx-1',
        buyerId: ALICE,
        sellerId: BOB,
        status: 'open',
      }),
    );
  });

  it('denies the buyer self-closing their dispute (CF-only)', async () => {
    const db = (await getTestEnv()).authenticatedContext(ALICE).firestore();
    await assertFails(
      updateDoc(doc(db, 'disputes', 'dispute-1'), { status: 'resolved' }),
    );
  });

  it('denies the seller modifying a dispute (CF-only)', async () => {
    const db = (await getTestEnv()).authenticatedContext(BOB).firestore();
    await assertFails(
      updateDoc(doc(db, 'disputes', 'dispute-1'), { status: 'dismissed' }),
    );
  });

  it('denies a party deleting a dispute (CF-only)', async () => {
    const db = (await getTestEnv()).authenticatedContext(ALICE).firestore();
    await assertFails(deleteDoc(doc(db, 'disputes', 'dispute-1')));
  });
});

// withdrawal_requests — read-only client view of pending/processed withdrawals.
// Created and mutated EXCLUSIVELY by walletWithdraw / reconcile CFs.
describe('withdrawal_requests rules (F114)', () => {
  beforeAll(async () => {
    await getTestEnv();
  });

  afterAll(async () => {
    await teardownTestEnv();
  });

  beforeEach(async () => {
    const env = await getTestEnv();
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'withdrawal_requests', 'wr-1'), {
        userId: ALICE,
        amountCents: 1000,
        status: 'processing',
      });
    });
  });

  it('allows the owner to read their own withdrawal request', async () => {
    const db = (await getTestEnv()).authenticatedContext(ALICE).firestore();
    await assertSucceeds(getDoc(doc(db, 'withdrawal_requests', 'wr-1')));
  });

  it('denies another user reading the withdrawal request', async () => {
    const db = (await getTestEnv()).authenticatedContext(BOB).firestore();
    await assertFails(getDoc(doc(db, 'withdrawal_requests', 'wr-1')));
  });

  it('denies a client creating a withdrawal request (CF-only)', async () => {
    const db = (await getTestEnv()).authenticatedContext(ALICE).firestore();
    await assertFails(
      setDoc(doc(db, 'withdrawal_requests', 'wr-hacker'), {
        userId: ALICE,
        amountCents: 999999,
        status: 'paid',
      }),
    );
  });

  it('denies the owner marking their withdrawal "paid" (CF-only)', async () => {
    const db = (await getTestEnv()).authenticatedContext(ALICE).firestore();
    await assertFails(
      updateDoc(doc(db, 'withdrawal_requests', 'wr-1'), { status: 'paid' }),
    );
  });
});

// automatic_decisions_log — Loi 25 transparency log. Parties may READ entries
// concerning their transaction (authorised via DENORMALISED buyerId/sellerId,
// F113). No client writes ever.
describe('automatic_decisions_log rules (F113 / F114)', () => {
  beforeAll(async () => {
    await getTestEnv();
  });

  afterAll(async () => {
    await teardownTestEnv();
  });

  beforeEach(async () => {
    const env = await getTestEnv();
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      // Denormalised parties (current writer shape).
      await setDoc(doc(db, 'automatic_decisions_log', 'log-1'), {
        transactionId: 'tx-1',
        userId: BOB,
        buyerId: ALICE,
        sellerId: BOB,
        decisionType: 'funds_released',
      });
      // Legacy doc WITHOUT denormalised parties — must fall back to the tx get().
      await setDoc(doc(db, 'automatic_decisions_log', 'log-legacy'), {
        transactionId: 'tx-legacy',
        userId: BOB,
        decisionType: 'label_refund',
      });
      await setDoc(doc(db, 'transactions', 'tx-legacy'), {
        articleId: 'a-legacy',
        buyerId: ALICE,
        sellerId: BOB,
        amount: 10,
        status: 'refunded',
      });
    });
  });

  it('allows the buyer to read a log entry via denormalised buyerId', async () => {
    const db = (await getTestEnv()).authenticatedContext(ALICE).firestore();
    await assertSucceeds(getDoc(doc(db, 'automatic_decisions_log', 'log-1')));
  });

  it('allows the seller to read a log entry via denormalised sellerId', async () => {
    const db = (await getTestEnv()).authenticatedContext(BOB).firestore();
    await assertSucceeds(getDoc(doc(db, 'automatic_decisions_log', 'log-1')));
  });

  it('denies a third party reading the log entry', async () => {
    const db = (await getTestEnv()).authenticatedContext(CHARLIE).firestore();
    await assertFails(getDoc(doc(db, 'automatic_decisions_log', 'log-1')));
  });

  it('allows a party reading a LEGACY entry via the tx get() fallback', async () => {
    const db = (await getTestEnv()).authenticatedContext(ALICE).firestore();
    await assertSucceeds(getDoc(doc(db, 'automatic_decisions_log', 'log-legacy')));
  });

  it('denies a third party reading a legacy entry', async () => {
    const db = (await getTestEnv()).authenticatedContext(CHARLIE).firestore();
    await assertFails(getDoc(doc(db, 'automatic_decisions_log', 'log-legacy')));
  });

  it('denies a client writing the log (CF-only)', async () => {
    const db = (await getTestEnv()).authenticatedContext(BOB).firestore();
    await assertFails(
      setDoc(doc(db, 'automatic_decisions_log', 'log-hacker'), {
        transactionId: 'tx-1',
        buyerId: ALICE,
        sellerId: BOB,
        decisionType: 'funds_released',
      }),
    );
  });
});

// wallet ledger subcollection — read-only for the wallet owner.
describe('wallet ledger rules (F114)', () => {
  beforeAll(async () => {
    await getTestEnv();
  });

  afterAll(async () => {
    await teardownTestEnv();
  });

  beforeEach(async () => {
    const env = await getTestEnv();
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'wallets', ALICE, 'ledger', 'entry-1'), {
        type: 'sale_credit',
        amountCents: 5000,
      });
    });
  });

  it('allows the owner to read their ledger entry', async () => {
    const db = (await getTestEnv()).authenticatedContext(ALICE).firestore();
    await assertSucceeds(getDoc(doc(db, 'wallets', ALICE, 'ledger', 'entry-1')));
  });

  it('denies another user reading the ledger entry', async () => {
    const db = (await getTestEnv()).authenticatedContext(BOB).firestore();
    await assertFails(getDoc(doc(db, 'wallets', ALICE, 'ledger', 'entry-1')));
  });

  it('denies the owner writing a ledger entry (CF-only)', async () => {
    const db = (await getTestEnv()).authenticatedContext(ALICE).firestore();
    await assertFails(
      setDoc(doc(db, 'wallets', ALICE, 'ledger', 'entry-hacker'), {
        type: 'sale_credit',
        amountCents: 999999,
      }),
    );
  });
});
