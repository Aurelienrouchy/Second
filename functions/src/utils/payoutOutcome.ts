/** A network/5xx error is an unknown outcome, never evidence to re-credit. */
import { getStripe } from '../config/stripe';

type StripeClient = NonNullable<ReturnType<typeof getStripe>>;

export function isDefinitiveStripeFailure(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { type, statusCode } = error as { type?: string; statusCode?: number };
  return (type === 'StripeInvalidRequestError' || type === 'StripeCardError') &&
    typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500 && statusCode !== 429;
}

/** Read-only recovery. Missing or ambiguous results remain unknown. Never create
 * another payout to discover whether one exists (Stripe idempotency expires).
 * The scan is bounded to 1000 recent payouts on the exact connected account.
 */
export async function resolveWithdrawalPayout(
  requestId: string,
  data: FirebaseFirestore.DocumentData,
  stripe: StripeClient
) {
  if (typeof data.stripeAccountId !== 'string') return null;
  const options = { stripeAccount: data.stripeAccountId };
  if (typeof data.stripePayoutId === 'string' && data.stripePayoutId) {
    return stripe.payouts.retrieve(data.stripePayoutId, undefined, options);
  }
  const createdAtMs = typeof data.createdAt?.toMillis === 'function'
    ? data.createdAt.toMillis() : data.createdAt instanceof Date ? data.createdAt.getTime() : null;
  if (createdAtMs == null) return null;
  let cursor: string | undefined;
  let match: Awaited<ReturnType<StripeClient['payouts']['list']>>['data'][number] | null = null;
  for (let page = 0; page < 10; page++) {
    const result = await stripe.payouts.list({
      limit: 100,
      created: { gte: Math.floor(createdAtMs / 1000) - 60 },
      ...(cursor ? { starting_after: cursor } : {}),
    }, options);
    for (const payout of result.data) {
      if (payout.metadata?.withdrawalRequestId !== requestId) continue;
      if (payout.amount !== data.amount || payout.currency !== (data.currency ?? 'cad') ||
          payout.metadata?.firebaseUserId !== data.userId || match) return null;
      match = payout;
    }
    if (!result.has_more) return match;
    cursor = result.data[result.data.length - 1]?.id;
    if (!cursor) return null;
  }
  return null;
}
