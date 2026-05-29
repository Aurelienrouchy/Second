"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.shipEngineWebhook = void 0;
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
const https_1 = require("firebase-functions/v2/https");
const logger = __importStar(require("firebase-functions/logger"));
const crypto_1 = require("crypto");
const firebase_1 = require("../config/firebase");
const shipEngine_1 = require("../config/shipEngine");
const trackingTransition_1 = require("../utils/trackingTransition");
/** Timing-safe equality for two short secret strings. */
function secretsMatch(a, b) {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    // timingSafeEqual throws on length mismatch; HMAC both to a fixed length so
    // the comparison itself never leaks length and never throws.
    const key = 'shipengine-webhook';
    const hA = (0, crypto_1.createHmac)('sha256', key).update(bufA).digest();
    const hB = (0, crypto_1.createHmac)('sha256', key).update(bufB).digest();
    return (0, crypto_1.timingSafeEqual)(hA, hB);
}
exports.shipEngineWebhook = (0, https_1.onRequest)({
    region: 'northamerica-northeast1',
    cors: false,
    memory: '512MiB',
    secrets: ['SHIPENGINE_WEBHOOK_SECRET'],
}, async (req, res) => {
    var _a, _b;
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
    const headerSecret = req.headers['x-shipengine-webhook-secret'] || '';
    const querySecret = typeof req.query.secret === 'string' ? req.query.secret : '';
    const presented = headerSecret || querySecret;
    if (!presented || !secretsMatch(presented, expectedSecret)) {
        logger.warn('[shipEngineWebhook] invalid or missing webhook secret — rejecting');
        res.status(401).send('Invalid webhook secret');
        return;
    }
    // ---- Parse + validate shape ----
    const body = (_a = req.body) !== null && _a !== void 0 ? _a : {};
    const data = (_b = body.data) !== null && _b !== void 0 ? _b : body; // tolerate both wrapped and flat payloads
    const statusCode = data.status_code || data.statusCode;
    const trackingNumber = data.tracking_number || data.trackingNumber;
    if (!statusCode || !trackingNumber || typeof trackingNumber !== 'string') {
        logger.warn('[shipEngineWebhook] missing status_code/tracking_number — ignoring', {
            resourceType: body.resource_type,
        });
        // 200 so ShipEngine does not retry a malformed/irrelevant event forever.
        res.json({ received: true, ignored: true });
        return;
    }
    try {
        // Find the transaction by tracking number. trackingNumber is effectively
        // unique per parcel; auto-index on equality is sufficient here.
        const snap = await firebase_1.db
            .collection('transactions')
            .where('trackingNumber', '==', trackingNumber)
            .limit(1)
            .get();
        if (snap.empty) {
            logger.info('[shipEngineWebhook] no transaction for tracking number', {
                trackingNumber,
            });
            res.json({ received: true, matched: false });
            return;
        }
        const doc = snap.docs[0];
        const transactionId = doc.id;
        const mapped = shipEngine_1.ShipEngineClient.mapStatus(statusCode);
        const result = await (0, trackingTransition_1.applyTrackingOutcome)(transactionId, mapped, 'webhook');
        logger.info('[shipEngineWebhook] tracking applied', {
            transactionId,
            trackingNumber,
            statusCode,
            mapped,
            outcome: result.kind,
            changed: 'changed' in result ? result.changed : false,
        });
        res.json({ received: true, transactionId, outcome: result.kind });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        logger.error('[shipEngineWebhook] processing error', { trackingNumber, error: message });
        // 500 so ShipEngine retries a transient failure.
        res.status(500).send(`Webhook processing error: ${message}`);
    }
});
//# sourceMappingURL=shipEngineWebhook.js.map