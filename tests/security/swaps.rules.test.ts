import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

import { getTestEnv, teardownTestEnv } from './helpers';

const ALICE = 'alice'; // initiator
const BOB = 'bob'; // receiver
const CHARLIE = 'charlie'; // third party
const SWAP_ID = 'swap-1';
const ITEM_ID = 'item-1';

// A proposed swap with a paid-status financial top-up. All sensitive
// transitions (payment_pending / accepted / photos_pending / shipping /
// completed / disputed / cancelled) are CF-only. The ONLY client write allowed
// is a participant declining a 'proposed' swap.
const baseSwap = {
  initiatorId: ALICE,
  receiverId: BOB,
  status: 'proposed',
  cashTopUp: 25,
  topUpAmount: 2500,
  tier: 'free',
};

describe('swaps rules (F53 / F114 / F115)', () => {
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
      await setDoc(doc(ctx.firestore(), 'swaps', SWAP_ID), baseSwap);
    });
  });

  // --- read ---------------------------------------------------------------
  it('allows the initiator to read their swap', async () => {
    const db = (await getTestEnv()).authenticatedContext(ALICE).firestore();
    await assertSucceeds(getDoc(doc(db, 'swaps', SWAP_ID)));
  });

  it('allows the receiver to read their swap', async () => {
    const db = (await getTestEnv()).authenticatedContext(BOB).firestore();
    await assertSucceeds(getDoc(doc(db, 'swaps', SWAP_ID)));
  });

  it('denies a third party reading the swap', async () => {
    const db = (await getTestEnv()).authenticatedContext(CHARLIE).firestore();
    await assertFails(getDoc(doc(db, 'swaps', SWAP_ID)));
  });

  // --- create -------------------------------------------------------------
  it('denies any client creating a swap (CF-only)', async () => {
    const db = (await getTestEnv()).authenticatedContext(ALICE).firestore();
    await assertFails(
      setDoc(doc(db, 'swaps', 'swap-hacker'), { ...baseSwap }),
    );
  });

  // --- decline (the single allowed client write) --------------------------
  it('allows a participant to decline a proposed swap', async () => {
    const db = (await getTestEnv()).authenticatedContext(BOB).firestore();
    await assertSucceeds(
      updateDoc(doc(db, 'swaps', SWAP_ID), {
        status: 'declined',
        declinedBy: BOB,
        declinedAt: new Date(),
        updatedAt: new Date(),
      }),
    );
  });

  it('denies a non-participant declining the swap', async () => {
    const db = (await getTestEnv()).authenticatedContext(CHARLIE).firestore();
    await assertFails(
      updateDoc(doc(db, 'swaps', SWAP_ID), {
        status: 'declined',
        declinedBy: CHARLIE,
        updatedAt: new Date(),
      }),
    );
  });

  // --- F115: declinedBy must be the caller --------------------------------
  it('denies attributing the decline to the OTHER party (F115)', async () => {
    const db = (await getTestEnv()).authenticatedContext(BOB).firestore();
    await assertFails(
      updateDoc(doc(db, 'swaps', SWAP_ID), {
        status: 'declined',
        declinedBy: ALICE, // BOB declines but blames ALICE
        updatedAt: new Date(),
      }),
    );
  });

  // --- F53: financial fields are CF-only ----------------------------------
  it('denies a participant mutating cashTopUp during a decline (F53)', async () => {
    const db = (await getTestEnv()).authenticatedContext(BOB).firestore();
    await assertFails(
      updateDoc(doc(db, 'swaps', SWAP_ID), {
        status: 'declined',
        declinedBy: BOB,
        cashTopUp: 0,
        updatedAt: new Date(),
      }),
    );
  });

  it('denies a participant mutating topUpAmount (F53)', async () => {
    const db = (await getTestEnv()).authenticatedContext(BOB).firestore();
    await assertFails(
      updateDoc(doc(db, 'swaps', SWAP_ID), {
        status: 'declined',
        declinedBy: BOB,
        topUpAmount: 1,
        updatedAt: new Date(),
      }),
    );
  });

  it('denies a participant self-granting a paid tier (F53)', async () => {
    const db = (await getTestEnv()).authenticatedContext(BOB).firestore();
    await assertFails(
      updateDoc(doc(db, 'swaps', SWAP_ID), {
        status: 'declined',
        declinedBy: BOB,
        tier: 'premium',
        updatedAt: new Date(),
      }),
    );
  });

  // --- sensitive status transitions are CF-only ---------------------------
  it('denies a participant moving the swap to "accepted" (CF-only)', async () => {
    const db = (await getTestEnv()).authenticatedContext(BOB).firestore();
    await assertFails(
      updateDoc(doc(db, 'swaps', SWAP_ID), {
        status: 'accepted',
        updatedAt: new Date(),
      }),
    );
  });

  it('denies a participant marking the swap "completed" (CF-only)', async () => {
    const db = (await getTestEnv()).authenticatedContext(ALICE).firestore();
    await assertFails(
      updateDoc(doc(db, 'swaps', SWAP_ID), {
        status: 'completed',
        updatedAt: new Date(),
      }),
    );
  });

  it('denies a participant seeding an arbitrary field during a decline', async () => {
    const db = (await getTestEnv()).authenticatedContext(BOB).firestore();
    await assertFails(
      updateDoc(doc(db, 'swaps', SWAP_ID), {
        status: 'declined',
        declinedBy: BOB,
        adminNote: 'pwned',
        updatedAt: new Date(),
      }),
    );
  });

  it('denies declining from a non-proposed status', async () => {
    const env = await getTestEnv();
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'swaps', SWAP_ID), {
        ...baseSwap,
        status: 'accepted',
      });
    });
    const db = env.authenticatedContext(BOB).firestore();
    await assertFails(
      updateDoc(doc(db, 'swaps', SWAP_ID), {
        status: 'declined',
        declinedBy: BOB,
        updatedAt: new Date(),
      }),
    );
  });

  // --- delete -------------------------------------------------------------
  it('denies a participant deleting a swap (CF-only via cancelSwap)', async () => {
    const db = (await getTestEnv()).authenticatedContext(ALICE).firestore();
    await assertFails(
      updateDoc(doc(db, 'swaps', SWAP_ID), { status: 'cancelled' }),
    );
  });
});

// swapParties (the permanent generalist Swap Zone) — counters are CF-only.
describe('swapParties rules (F114)', () => {
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
      await setDoc(doc(ctx.firestore(), 'swapParties', 'zone-1'), {
        itemsCount: 5,
        swapsCount: 2,
      });
    });
  });

  it('allows anyone to read the swap zone counters', async () => {
    const db = (await getTestEnv()).authenticatedContext(ALICE).firestore();
    await assertSucceeds(getDoc(doc(db, 'swapParties', 'zone-1')));
  });

  it('denies a client creating a swap party (CF-only)', async () => {
    const db = (await getTestEnv()).authenticatedContext(ALICE).firestore();
    await assertFails(
      setDoc(doc(db, 'swapParties', 'zone-hacker'), { itemsCount: 0 }),
    );
  });

  it('denies a client mutating the zone counters (CF-only)', async () => {
    const db = (await getTestEnv()).authenticatedContext(ALICE).firestore();
    await assertFails(
      updateDoc(doc(db, 'swapParties', 'zone-1'), { itemsCount: 9999 }),
    );
  });
});

// swapPartyItems — owner may add/remove, but never seed the CF-managed
// lifecycle flags at create (F112).
describe('swapPartyItems rules (F112 / F114)', () => {
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
      await setDoc(doc(ctx.firestore(), 'swapPartyItems', ITEM_ID), {
        sellerId: ALICE,
        articleId: 'article-1',
        isSwapped: false,
        isPending: false,
      });
    });
  });

  it('allows an owner to deposit their own item', async () => {
    const db = (await getTestEnv()).authenticatedContext(ALICE).firestore();
    await assertSucceeds(
      setDoc(doc(db, 'swapPartyItems', 'item-new'), {
        sellerId: ALICE,
        articleId: 'article-2',
      }),
    );
  });

  it('denies depositing an item for someone else', async () => {
    const db = (await getTestEnv()).authenticatedContext(BOB).firestore();
    await assertFails(
      setDoc(doc(db, 'swapPartyItems', 'item-new'), {
        sellerId: ALICE,
        articleId: 'article-2',
      }),
    );
  });

  it('denies seeding isSwapped=true at create (F112)', async () => {
    const db = (await getTestEnv()).authenticatedContext(ALICE).firestore();
    await assertFails(
      setDoc(doc(db, 'swapPartyItems', 'item-new'), {
        sellerId: ALICE,
        articleId: 'article-2',
        isSwapped: true,
      }),
    );
  });

  it('denies seeding isPending=true at create (F112)', async () => {
    const db = (await getTestEnv()).authenticatedContext(ALICE).firestore();
    await assertFails(
      setDoc(doc(db, 'swapPartyItems', 'item-new'), {
        sellerId: ALICE,
        articleId: 'article-2',
        isPending: true,
      }),
    );
  });

  it('denies seeding a CF-managed swap pointer at create (F112)', async () => {
    const db = (await getTestEnv()).authenticatedContext(ALICE).firestore();
    await assertFails(
      setDoc(doc(db, 'swapPartyItems', 'item-new'), {
        sellerId: ALICE,
        articleId: 'article-2',
        swapId: 'forged-swap',
      }),
    );
  });

  it('allows seeding isSwapped=false explicitly at create', async () => {
    const db = (await getTestEnv()).authenticatedContext(ALICE).firestore();
    await assertSucceeds(
      setDoc(doc(db, 'swapPartyItems', 'item-new'), {
        sellerId: ALICE,
        articleId: 'article-2',
        isSwapped: false,
        isPending: false,
      }),
    );
  });

  it('denies the owner flipping isSwapped on update (CF-only)', async () => {
    const db = (await getTestEnv()).authenticatedContext(ALICE).firestore();
    await assertFails(
      updateDoc(doc(db, 'swapPartyItems', ITEM_ID), { isSwapped: true }),
    );
  });
});
