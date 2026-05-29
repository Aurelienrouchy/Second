/**
 * ShipEngine tracking webhook (PRIMARY tracking path)
 * Firebase Functions v2 - onRequest, region northamerica-northeast1
 *
 * ShipEngine pushes a tracking update whenever a parcel's status changes
 * (carrier scan, in-transit, delivered, exception). This endpoint is the
 * primary tracking path; the scheduled poller (trackingCheck.ts) is a spaced
 * safety net for missed webhooks.
 *
 * AUTHENTICITY
 * ------------
 * ShipEngine tracking webhooks are not HMAC-signed by default. We protect this
 * endpoint with a shared secret configured on the webhook URL: ShipEngine is
 * registered with a `?secret=<SHIPENGINE_WEBHOOK_SECRET>` query string and/or
 * an `X-ShipEngine-Webhook-Secret` header. The request is rejected 401 unless
 * the presented secret matches (timing-safe). If the secret is not configured
 * server-side we reject 500 (fail closed) rather than process unauthenticated
 * traffic.
 *
 * SHAPE
 * -----
 * ShipEngine sends `{ resource_type: 'API_TRACK', resource_url, data: {...} }`.
 * The embedded `data` carries `status_code`, `carrier_code`, `tracking_number`.
 * We map the status via ShipEngineClient.mapStatus and apply the same
 * state-machine transition as the poller via applyTrackingOutcome.
 *
 * IDEMPOTENCE: applyTrackingOutcome is status-guarded and idempotent, so a
 * replayed webhook is a safe no-op.
 */
import { onRequest } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { createHmac, timingSafeEqual } from 'crypto';
import { db } from '../config/firebase';
import { ShipEngineClient } from '../config/shipEngine';
import { applyTrackingOutcome } from '../utils/trackingTransition';
import { processReturnDelivered } from '../utils/returnRefund';

/** Timing-safe equality for two short secret strings. */
function secretsMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  // timingSafeEqual throws on length mismatch; HMAC both to a fixed length so
  // the comparison itself never leaks length and never throws.
  const key = 'shipengine-webhook';
  const hA = createHmac('sha256', key).update(bufA).digest();
  const hB = createHmac('sha256', key).update(bufB).digest();
  return timingSafeEqual(hA, hB);
}

export const shipEngineWebhook = onRequest(
  {
    region: 'northamerica-northeast1',
    cors: false,
    memory: '512MiB',
    secrets: ['SHIPENGINE_WEBHOOK_SECRET'],
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).send('Method not allowed');
      return;
    }

    // ---- Authenticity: shared secret (header or query string) ----
    const expectedSecret = process.env.SHIPENGINE_WEBHOOK_SECRET;
    if (!expectedSecret) {
      logger.error('[shipEngineWebhook] SHIPENGINE_WEBHOOK_SECRET not configured — rejecting');
      res.status(500).send('Webhook secret not configured');
      return;
    }

    const headerSecret =
      (req.headers['x-shipengine-webhook-secret'] as string | undefined) || '';
    const querySecret =
      typeof req.query.secret === 'string' ? req.query.secret : '';
    const presented = headerSecret || querySecret;

    if (!presented || !secretsMatch(presented, expectedSecret)) {
      logger.warn('[shipEngineWebhook] invalid or missing webhook secret — rejecting');
      res.status(401).send('Invalid webhook secret');
      return;
    }

    // ---- Parse + validate shape ----
    const body = req.body ?? {};
    const data = body.data ?? body; // tolerate both wrapped and flat payloads

    const statusCode: string | undefined = data.status_code || data.statusCode;
    const trackingNumber: string | undefined =
      data.tracking_number || data.trackingNumber;

    if (!statusCode || !trackingNumber || typeof trackingNumber !== 'string') {
      logger.warn('[shipEngineWebhook] missing status_code/tracking_number — ignoring', {
        resourceType: body.resource_type,
      });
      // 200 so ShipEngine does not retry a malformed/irrelevant event forever.
      res.json({ received: true, ignored: true });
      return;
    }

    try {
      const mapped = ShipEngineClient.mapStatus(statusCode);

      // Find the transaction by FORWARD-leg tracking number. trackingNumber is
      // effectively unique per parcel; auto-index on equality is sufficient.
      const snap = await db
        .collection('transactions')
        .where('trackingNumber', '==', trackingNumber)
        .limit(1)
        .get();

      if (!snap.empty) {
        const doc = snap.docs[0];
        const transactionId = doc.id;
        const result = await applyTrackingOutcome(transactionId, mapped, 'webhook');

        logger.info('[shipEngineWebhook] tracking applied', {
          transactionId,
          trackingNumber,
          statusCode,
          mapped,
          outcome: result.kind,
          changed: 'changed' in result ? result.changed : false,
        });

        res.json({ received: true, transactionId, outcome: result.kind });
        return;
      }

      // No forward-leg match: this may be a RETURN parcel. Match by the
      // returnTrackingNumber stored at requestReturn time.
      const returnSnap = await db
        .collection('transactions')
        .where('returnTrackingNumber', '==', trackingNumber)
        .limit(1)
        .get();

      if (returnSnap.empty) {
        logger.info('[shipEngineWebhook] no transaction for tracking number', {
          trackingNumber,
        });
        res.json({ received: true, matched: false });
        return;
      }

      const returnDoc = returnSnap.docs[0];
      const transactionId = returnDoc.id;

      // DELIVERED on the return leg = seller received the item back -> refund the
      // buyer (total - returnLabelCost), debit the seller. Idempotent.
      if (mapped === 'DELIVERED') {
        const returnResult = await processReturnDelivered(transactionId, 'webhook');
        logger.info('[shipEngineWebhook] return delivered processed', {
          transactionId,
          trackingNumber,
          refunded: returnResult.refunded,
          alreadyRefunded: returnResult.alreadyRefunded ?? false,
        });
        res.json({ received: true, transactionId, outcome: 'return_refunded' });
        return;
      }

      // Non-DELIVERED return scan: best-effort refresh of the return tracking
      // status for visibility. No money movement, no state change.
      await returnDoc.ref
        .update({ returnTrackingStatus: mapped })
        .catch(() => undefined);
      logger.info('[shipEngineWebhook] return tracking refreshed', {
        transactionId,
        trackingNumber,
        statusCode,
        mapped,
      });
      res.json({ received: true, transactionId, outcome: 'return_tracking_updated' });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('[shipEngineWebhook] processing error', { trackingNumber, error: message });
      // 500 so ShipEngine retries a transient failure.
      res.status(500).send(`Webhook processing error: ${message}`);
    }
  }
);
