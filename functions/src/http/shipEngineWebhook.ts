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
 * The event is a lookup hint only. A unique order and its saved label are
 * re-read through the official label/track endpoints before any transition.
 *
 * Identity is rechecked inside the transition transaction. Event chronology
 * and corrected delivery outcomes are separate guards, not inferred here.
 */
import { onRequest } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { createHmac, timingSafeEqual } from 'crypto';
import { db, FieldValue } from '../config/firebase';
import { ShipEngineClient, trackingObservationDisposition } from '../config/shipEngine';
import { applyTrackingOutcome, readQualifiedTracking, recordTrackingReview, trackingOutcomeMatches } from '../utils/trackingTransition';
import { processReturnDelivered } from '../utils/returnRefund';
import { withFinancialRecoveryScope, assertFinancialRecoveryEffect, preserveFinancialRecoveryObservation, FinancialRecoveryBlocked } from '../utils/financialRecoveryInterlock';
import { recoveryDigest } from '../config/recoveryControl';

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
    secrets: ['SHIPENGINE_WEBHOOK_SECRET', 'SHIPENGINE_API_KEY', 'STRIPE_SECRET_KEY'],
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

    let recoveryEvidencePreserved = false;
    try {
    // ---- Parse + validate shape ----
    const body = req.body ?? {};
    const data = body.data ?? body; // tolerate both wrapped and flat payloads

    const statusCode: string | undefined = data.status_code || data.statusCode;
    const trackingNumber: string | undefined =
      data.tracking_number || data.trackingNumber;

    const payloadHash = recoveryDigest((req as {rawBody?:Buffer}).rawBody ?? Buffer.from(JSON.stringify(body)));
    const nativeFacts: Record<string,string|number|boolean|null> = {};
    for (const [key,value] of Object.entries({statusCode,trackingNumber,carrierCode:data.carrier_code ?? data.carrierCode})) {
      if (typeof value === 'string' && value.length <= 200 && /^[a-zA-Z0-9_. :/-]*$/.test(value)) nativeFacts[key] = value;
    }
    await preserveFinancialRecoveryObservation({provider:'shipengine',eventId:payloadHash,eventType:'API_TRACK',payloadHash,
      accountId:null,liveMode:null,objectIds:[],facts:nativeFacts});
    recoveryEvidencePreserved = true;

    if (typeof statusCode !== 'string' || typeof trackingNumber !== 'string' || !trackingNumber.trim() || trackingNumber.length > 200 ||
        (body.resource_type != null && body.resource_type !== 'API_TRACK')) {
      logger.warn('[shipEngineWebhook] missing status_code/tracking_number — ignoring', {
        resourceType: body.resource_type,
      });
      // 200 so ShipEngine does not retry a malformed/irrelevant event forever.
      res.json({ received: true, ignored: true });
      return;
    }

      const result = await withFinancialRecoveryScope({operation:'shipEngineWebhook',sourceRefs:[payloadHash]}, async () => {
      await assertFinancialRecoveryEffect('webhook_admission', {sourceHash:payloadHash});
      // The event is only a lookup hint. Reused numbers and cross-leg matches
      // cannot select an order; the saved label's current API read is authority.
      const [forward, returned] = await Promise.all([
        db.collection('transactions').where('trackingNumber', '==', trackingNumber).limit(2).get(),
        db.collection('transactions').where('returnTrackingNumber', '==', trackingNumber).limit(2).get(),
      ]);
      if (forward.size + returned.size !== 1) {
        for (const doc of forward.docs) await recordTrackingReview(doc.id, doc.data(), 'forward', 'tracking_number_ambiguous');
        for (const doc of returned.docs) await recordTrackingReview(doc.id, doc.data(), 'return', 'tracking_number_ambiguous');
        logger.warn('[shipEngineWebhook] tracking hint not uniquely bound', {trackingNumber, forward: forward.size, returned: returned.size});
        return {received: true, matched: false, reviewRequired: !forward.empty || !returned.empty};
      }
      const leg = forward.empty ? 'return' : 'forward';
      const doc = (forward.empty ? returned : forward).docs[0], transactionId = doc.id, order = doc.data();
      const eventCarrier = data.carrier_code ?? data.carrierCode;
      const savedCarrier = leg === 'forward' ? order.carrierCode : order.returnCarrierCode;
      if (eventCarrier != null && (typeof eventCarrier !== 'string' || eventCarrier !== savedCarrier)) {
        await recordTrackingReview(transactionId, order, leg, 'tracking_hint_carrier_contradictory');
        return {received: true, transactionId, reviewRequired: true};
      }
      const tracking = await readQualifiedTracking(transactionId, order, leg);
      const mapped = ShipEngineClient.mapStatus(tracking.statusCode);
      if (leg === 'forward') {
        const result = await applyTrackingOutcome(transactionId, mapped, 'webhook', tracking.proof);
        logger.info('[shipEngineWebhook] exact label tracking observed', {transactionId, labelId: tracking.proof.labelId,
          eventStatus: statusCode, currentStatus: tracking.statusCode, outcome: result.kind});
        return {received: true, transactionId, outcome: result.kind};
      }
      if (mapped === 'DELIVERED') {
        const result = await processReturnDelivered(transactionId, 'webhook', tracking.proof);
        return {received: true, transactionId, outcome: result.refunded ? 'return_refunded' : 'return_received_unsettled'};
      }
      await db.runTransaction(async tx => {
        const current = (await tx.get(doc.ref)).data();
        if (current && await trackingOutcomeMatches(tx, transactionId, current, tracking.proof, 'return')) {
          await assertFinancialRecoveryEffect('firestore_commit', {refs:[doc.ref.path]});
          const snapshot = trackingObservationDisposition(current, tracking.proof, 'return') === 'snapshot';
          tx.update(doc.ref, {...(!current.returnDeliveredAt ? {returnTrackingStatus: mapped} : {}), returnTrackingObservedAt: FieldValue.serverTimestamp(),
            [snapshot ? 'returnTrackingSnapshot' : 'returnTrackingObservation']: {...tracking.proof, source: 'webhook', recordedAt: FieldValue.serverTimestamp()}});
        }
      });
      return {received: true, transactionId, outcome: 'return_tracking_updated'};
      });
      res.json(result);
    } catch (error: unknown) {
      if (recoveryEvidencePreserved && error instanceof FinancialRecoveryBlocked) {
        res.json({received:true,deferred:true}); return;
      }
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('[shipEngineWebhook] processing error', { error: message });
      // 500 so ShipEngine retries a transient failure.
      res.status(500).send('Tracking observation unavailable');
    }
  }
);
