import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

import { getTestEnv, teardownTestEnv } from './helpers';

const ALICE = 'alice';
const BOB = 'bob';
const CHARLIE = 'charlie';
const TX_ID = 'tx-1';

const baseTx = {
  articleId: 'article-1',
  buyerId: ALICE,
  sellerId: BOB,
  amount: 50,
  status: 'meetup_pending',
};

describe('transactions rules', () => {
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
      await setDoc(doc(ctx.firestore(), 'transactions', TX_ID), baseTx);
    });
  });

  it('allows buyer to read their own transaction', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(ALICE).firestore();
    await assertSucceeds(getDoc(doc(db, 'transactions', TX_ID)));
  });

  it('allows seller to read their own transaction', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(BOB).firestore();
    await assertSucceeds(getDoc(doc(db, 'transactions', TX_ID)));
  });

  it('denies a third party reading the transaction', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(CHARLIE).firestore();
    await assertFails(getDoc(doc(db, 'transactions', TX_ID)));
  });

  // La confirmation de rencontre passe par la callable `confirmMeetupTransaction`
  // depuis le 2026-06-02. La branche de règles qui autorisait le vendeur à
  // l'écrire lui-même a été supprimée : elle laissait passer une confirmation
  // sans auteur (`meetupConfirmedBy` était hors de l'ensemble de clés autorisé)
  // et sans contrainte d'horodatage, alors que la fenêtre d'avis et le balayage
  // à 7 jours se calent sur `meetupConfirmedAt`.
  it('refuse au vendeur d\'écrire lui-même meetup_confirmed (callable seule)', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(BOB).firestore();
    await assertFails(
      updateDoc(doc(db, 'transactions', TX_ID), { status: 'meetup_confirmed' }),
    );
  });

  it('denies user updating status to "paid" (CF-only)', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(ALICE).firestore();
    await assertFails(
      updateDoc(doc(db, 'transactions', TX_ID), { status: 'paid' }),
    );
  });

  it('denies user updating status to "cancelled" (CF-only)', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(BOB).firestore();
    await assertFails(
      updateDoc(doc(db, 'transactions', TX_ID), { status: 'cancelled' }),
    );
  });

  it('refuse la confirmation cliente même complète (statut + horodatage)', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(BOB).firestore();
    await assertFails(
      updateDoc(doc(db, 'transactions', TX_ID), {
        status: 'meetup_confirmed',
        meetupConfirmedAt: new Date(),
        updatedAt: new Date(),
      }),
    );
  });

  it('laisse passer le seul écrit client encore autorisé : updatedAt', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(BOB).firestore();
    await assertSucceeds(
      updateDoc(doc(db, 'transactions', TX_ID), { updatedAt: new Date() }),
    );
  });

  it('denies buyer self-confirming a meetup (seller-only)', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(ALICE).firestore();
    await assertFails(
      updateDoc(doc(db, 'transactions', TX_ID), { status: 'meetup_confirmed' }),
    );
  });

  it('denies client setting disputed=true (CF-only sensitive field)', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(BOB).firestore();
    await assertFails(
      updateDoc(doc(db, 'transactions', TX_ID), { disputed: true }),
    );
  });

  it('denies a party creating a bank dispute state (server-only)', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(BOB).firestore();
    await assertFails(updateDoc(doc(db, 'transactions', TX_ID), {
      bankDispute: { id: 'du_forged', state: 'closed', outcome: 'won', closedAt: new Date() },
    }));
  });

  it('denies a party clearing or qualifying the bank guard while updating updatedAt', async () => {
    const env = await getTestEnv();
    await env.withSecurityRulesDisabled(async ctx => {
      await updateDoc(doc(ctx.firestore(), 'transactions', TX_ID), {
        bankDispute: { id: 'du_open', state: 'open', outcome: null },
      });
    });
    const db = env.authenticatedContext(ALICE).firestore();
    await assertFails(updateDoc(doc(db, 'transactions', TX_ID), { bankDispute: null, updatedAt: new Date() }));
    await assertFails(updateDoc(doc(db, 'transactions', TX_ID), { 'bankDispute.state': 'closed' }));
  });

  it('denies client setting fundsReleaseAt (escrow release is CF-only)', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(BOB).firestore();
    await assertFails(
      updateDoc(doc(db, 'transactions', TX_ID), { fundsReleaseAt: new Date() }),
    );
  });

  it('denies client writing trackingNumber (shipping is CF-only)', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(BOB).firestore();
    await assertFails(
      updateDoc(doc(db, 'transactions', TX_ID), { trackingNumber: 'fake-1Z' }),
    );
  });

  it('denies client clearing labelCreationPending (CF-only sensitive field)', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(BOB).firestore();
    await assertFails(
      updateDoc(doc(db, 'transactions', TX_ID), { labelCreationPending: false }),
    );
  });

  it('denies client mutating meetupSpot (immutable after creation)', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(BOB).firestore();
    await assertFails(
      updateDoc(doc(db, 'transactions', TX_ID), {
        meetupSpot: { name: 'X', address: 'Y', category: 'cafe' },
      }),
    );
  });

  it('denies client lowering the transaction amount', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(ALICE).firestore();
    await assertFails(
      updateDoc(doc(db, 'transactions', TX_ID), { amount: 1 }),
    );
  });

  // B2/B3 buyer-return leg: a buyer is a party to the tx, so without the
  // sensitive-field guard they could forge these and inflate / fake-trigger the
  // return refund. All are CF-only (requestReturn / processReturnDelivered).
  it('denies buyer forging returnLabelCost (refund-inflation)', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(ALICE).firestore();
    await assertFails(
      updateDoc(doc(db, 'transactions', TX_ID), { returnLabelCost: 0 }),
    );
  });

  it('denies buyer forging returnTrackingNumber (CF-only)', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(ALICE).firestore();
    await assertFails(
      updateDoc(doc(db, 'transactions', TX_ID), { returnTrackingNumber: 'fake-RZ' }),
    );
  });

  it('denies buyer forging returnDeliveredAt (fake return-refund trigger)', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(ALICE).firestore();
    await assertFails(
      updateDoc(doc(db, 'transactions', TX_ID), { returnDeliveredAt: new Date() }),
    );
  });

  it('denies seller forging returnReason (CF-only sensitive field)', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(BOB).firestore();
    await assertFails(
      updateDoc(doc(db, 'transactions', TX_ID), { returnReason: 'damaged' }),
    );
  });

  // F110 — the shipping address must not be mutable post-creation by a party
  // (the sweepPendingLabels job reads it to buy the carrier label).
  it('denies a party mutating shippingAddress post-creation (F110)', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(ALICE).firestore();
    await assertFails(
      updateDoc(doc(db, 'transactions', TX_ID), {
        shippingAddress: { street: 'hacker st', city: 'X', province: 'QC', postalCode: 'A1A1A1' },
      }),
    );
  });

  // F111 — the guard is an ALLOWLIST: any field outside {updatedAt} (or the
  // meetup-confirmation set) is rejected, so a forgotten/arbitrary field can
  // never become client-writable.
  it('denies a party seeding an arbitrary field (F111 allowlist)', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(ALICE).firestore();
    await assertFails(
      updateDoc(doc(db, 'transactions', TX_ID), { someArbitraryField: 'pwned' }),
    );
  });

  it('denies a party forging noShowReport (F111 allowlist)', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(BOB).firestore();
    await assertFails(
      updateDoc(doc(db, 'transactions', TX_ID), { noShowReport: { by: BOB } }),
    );
  });

  // The allowlist still permits a benign updatedAt-only re-stamp.
  it('allows a party writing only updatedAt (allowlist path A)', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(ALICE).firestore();
    await assertSucceeds(
      updateDoc(doc(db, 'transactions', TX_ID), { updatedAt: new Date() }),
    );
  });
});

describe('transactions refund fields are server-only', () => {
  beforeAll(async () => { await getTestEnv(); });
  afterAll(async () => { await teardownTestEnv(); });
  beforeEach(async () => {
    const env = await getTestEnv(); await env.clearFirestore();
    await env.withSecurityRulesDisabled(async ctx => { await setDoc(doc(ctx.firestore(), 'transactions', TX_ID), {
      ...baseTx, refundBlocked: true, refund: { intentId: 'server_intent', state: 'pending', cardAmountCents: 5000 },
    }); });
  });
  it.each([ALICE, BOB])('denies %s injecting or erasing refund intent/reserve', async uid => {
    const db = (await getTestEnv()).authenticatedContext(uid).firestore();
    await assertFails(updateDoc(doc(db, 'transactions', TX_ID), { refund: { state: 'succeeded', fundsAppliedAt: new Date() } }));
    await assertFails(updateDoc(doc(db, 'transactions', TX_ID), { refund: null }));
    await assertFails(updateDoc(doc(db, 'transactions', TX_ID), { refundBlocked: false }));
    await assertFails(updateDoc(doc(db, 'transactions', TX_ID), { 'refund.freezeCents': 0 }));
    await assertFails(updateDoc(doc(db, 'transactions', TX_ID), { 'refund.attemptId': 'client_retry' }));
  });
});
