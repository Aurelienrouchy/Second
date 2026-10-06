import { describe, expect, it } from 'vitest';
import { createStripeMock } from './testHelpers/firestoreMock';
import { isDefinitiveStripeFailure, resolveWithdrawalPayout } from './payoutOutcome';

const request = { stripeAccountId: 'acct_seller', amount: 2500, currency: 'cad', userId: 'seller', createdAt: new Date() };
const payout = { id: 'po_recovered', status: 'paid', amount: 2500, currency: 'cad',
  metadata: { withdrawalRequestId: 'wr1', firebaseUserId: 'seller' } };

describe('read-only unknown payout resolution', () => {
  it.each([new Error('timeout'), { type: 'StripeAPIError', statusCode: 500 }, { type: 'StripeInvalidRequestError', statusCode: 429 }])('never treats a transport/server error as a confirmed rejection', error => {
    expect(isDefinitiveStripeFailure(error)).toBe(false);
  });
  it('recognises a confirmed Stripe rejection', () => {
    expect(isDefinitiveStripeFailure({ type: 'StripeInvalidRequestError', statusCode: 400 })).toBe(true);
  });
  it('recovers an unpersisted payout by exact request metadata on the connected account', async () => {
    const stripe = createStripeMock();
    stripe.impl.payoutsList = async () => ({ data: [payout], has_more: false });
    expect((await resolveWithdrawalPayout('wr1', request, stripe.client as never))?.id).toBe('po_recovered');
    expect(stripe.calls.payoutsCreate).toHaveLength(0);
    expect(stripe.calls.payoutsList[0][1]).toEqual({ stripeAccount: 'acct_seller' });
  });
  it.each([[], [{ ...payout, amount: 2499 }], [payout, { ...payout, id: 'po_duplicate' }]].map(data => ({ data })))('retains unknown for missing, mismatched or multiple payouts', async ({ data }) => {
    const stripe = createStripeMock();
    stripe.impl.payoutsList = async () => ({ data, has_more: false });
    expect(await resolveWithdrawalPayout('wr1', request, stripe.client as never)).toBeNull();
    expect(stripe.calls.payoutsCreate).toHaveLength(0);
  });
  it('paginates but does not certify a result from an incomplete bounded scan', async () => {
    const stripe = createStripeMock();
    stripe.impl.payoutsList = async () => ({ data: [{ id: 'po_other', metadata: {} }], has_more: true });
    expect(await resolveWithdrawalPayout('wr1', request, stripe.client as never)).toBeNull();
    expect(stripe.calls.payoutsList).toHaveLength(10);
  });
});
