/**
 * featureFlags (server) — SERVER-AUTHORITATIVE feature flags for the financial
 * rails. The client mirror (`config/featureFlags.ts` at the app root) only hides
 * UI; it does NOT protect the callables, which remain invocable by a direct
 * client call. These server flags are the real gate.
 *
 * F137 — SHIPPING_ENABLED:
 *   The shipping rail (ShipEngine label purchase, Stripe charge that includes the
 *   shipping cost) must not be invocable while shipping is disabled. This guard
 *   refuses any SHIPPING transaction / checkout server-side. The MEETUP rail
 *   (no shipping, no label) is NEVER gated by this flag.
 *
 *   Default: OFF (false) — coherent with the current client flag
 *   (`config/featureFlags.ts` → SHIPPING_ENABLED = false). Shipping stays closed
 *   until the founder explicitly opens it.
 *
 *   To enable shipping for tests / launch, set the Cloud Functions env var:
 *     firebase functions:config is deprecated; use a .env / secret param. With
 *     the v2 SDK, define it in `functions/.env` (or per-deploy environment):
 *       SHIPPING_ENABLED=true
 *     Then redeploy createTransaction + createStripeCheckout. Any value other
 *     than the exact string 'true' (case-insensitive) keeps shipping OFF.
 */

/**
 * True only when the shipping rail is explicitly enabled server-side.
 * Read at call time (not module load) so a redeploy/restart with a new env value
 * takes effect without code change. Defaults to false (OFF) when unset.
 */
export function isShippingEnabled(): boolean {
  return (process.env.SHIPPING_ENABLED ?? '').trim().toLowerCase() === 'true';
}
