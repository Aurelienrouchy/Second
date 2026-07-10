/**
 * Server-side PostHog analytics (posthog-node) — Cloud Functions source of truth
 * for financial + state-transition events (§12 "backend" domain of
 * analytics-events.md). The client SDK may be absent when the fact happens
 * (Stripe webhook, scheduled jobs, ShipEngine tracking), so these events are
 * emitted here.
 *
 * Config:
 *  - Project key read from POSTHOG_API_KEY (a PUBLIC capture-only key — NOT a
 *    secret, so it lives in functions/.env / process.env, not Secret Manager).
 *  - Host from POSTHOG_HOST (defaults to US cloud).
 *  - Key absent → no-op (never initialises, never throws) so tests / local
 *    emulators run silently.
 *
 * Serverless posture: flushAt:1 / flushInterval:0 and captureImmediate() so the
 * event is sent inline (no background queue that a frozen container would drop).
 * captureServerEvent NEVER throws — analytics must not break a financial path.
 */
import * as logger from 'firebase-functions/logger';
import { PostHog } from 'posthog-node';

/**
 * Server event catalogue (§12). Exhaustive — captureServerEvent only accepts
 * these names so no off-catalogue event can be emitted from the backend.
 */
export type ServerEvent =
  | 'order_created'
  | 'order_paid'
  | 'sale_paid'
  | 'shipping_label_purchased'
  | 'order_shipped'
  | 'order_delivered'
  | 'order_completed'
  | 'order_cancelled'
  | 'order_refunded'
  | 'dispute_opened'
  | 'dispute_resolved'
  | 'seller_activated'
  | 'withdrawal_requested'
  | 'withdrawal_paid'
  | 'withdrawal_failed'
  | 'swap_topup_paid'
  | 'swap_completed'
  | 'swap_expired'
  | 'swap_dispute_resolved'
  | 'shop_tier_activated'
  | 'account_deleted';

let client: PostHog | null = null;
let initialised = false;

function getClient(): PostHog | null {
  if (initialised) return client;
  initialised = true;

  const apiKey = process.env.POSTHOG_API_KEY?.trim();
  if (!apiKey) {
    logger.info('[analytics] POSTHOG_API_KEY absent — server analytics disabled (no-op)');
    return null;
  }

  const host = process.env.POSTHOG_HOST?.trim() || 'https://us.i.posthog.com';
  client = new PostHog(apiKey, {
    host,
    flushAt: 1,
    flushInterval: 0,
  });
  return client;
}

/**
 * Capture one server event and send it inline. Never throws.
 *
 * @param distinctId Firebase uid of the actor the event belongs to (buyer for a
 *                   purchase, seller for an activation/withdrawal, etc. — see §12).
 * @param event      catalogue name (server domain).
 * @param properties event properties. Pass `$insert_id` (business id such as
 *                   transaction_id / withdrawal_id / swap_id) for idempotence
 *                   against webhook replays. Pass `$set` for user properties.
 */
export async function captureServerEvent(
  distinctId: string,
  event: ServerEvent,
  properties: Record<string, unknown> = {}
): Promise<void> {
  try {
    const ph = getClient();
    if (!ph) return;
    if (!distinctId) {
      logger.warn('[analytics] skipping event with empty distinctId', { event });
      return;
    }
    await ph.captureImmediate({
      distinctId,
      event,
      properties,
    });
  } catch (err) {
    // Analytics must never break a financial / transactional path.
    logger.warn('[analytics] captureServerEvent failed (ignored)', {
      event,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
