"use strict";
/**
 * ShipEngine API client
 * Multi-carrier shipping: Intelcom (Dragonfly) + Canada Post
 * Documentation: https://www.shipengine.com/docs/
 *
 * ShipEngine wraps multiple carriers behind a single API.
 * We use it for: rate shopping, label creation, tracking, PUDO locations.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ShipEngineClient = exports.getShipEngine = void 0;
// =============================================================================
// CLIENT
// =============================================================================
// Per-attempt network timeout. ShipEngine rate/label calls are normally well
// under a second; 15s is a generous ceiling that still lets the webhook handler
// respond before Stripe's retry window — a hung fetch would otherwise block the
// 200 response and trigger duplicate Stripe webhook deliveries (P1-17/P1-27).
const REQUEST_TIMEOUT_MS = 15000;
// Exponential backoff schedule (ms) for transient failures. The number of
// entries also caps the number of RETRIES (so 3 here => up to 4 attempts).
const RETRY_BACKOFF_MS = [500, 1000, 2000];
// HTTP statuses worth retrying: 429 (rate limited) + 5xx (server-side).
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/**
 * Error carrying the HTTP status so callers / the retry loop can branch on it.
 */
class ShipEngineHttpError extends Error {
    constructor(status, message) {
        super(message);
        this.name = 'ShipEngineHttpError';
        this.status = status;
    }
}
class ShipEngineClient {
    constructor(config) {
        this.config = config;
    }
    /**
     * Performs a single HTTP attempt with an AbortController timeout. Throws
     * `ShipEngineHttpError` on a non-OK response (carrying the status) and a
     * generic timeout/network Error otherwise.
     */
    async requestOnce(method, url, body) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        let response;
        try {
            response = await fetch(url, {
                method,
                headers: {
                    'Content-Type': 'application/json',
                    'API-Key': this.config.apiKey,
                },
                body: body ? JSON.stringify(body) : undefined,
                signal: controller.signal,
            });
        }
        catch (err) {
            // AbortError (timeout) or network failure — both transient/retryable.
            const message = err instanceof Error && err.name === 'AbortError'
                ? `ShipEngine request timed out after ${REQUEST_TIMEOUT_MS}ms`
                : `ShipEngine network error: ${err instanceof Error ? err.message : String(err)}`;
            throw new Error(message);
        }
        finally {
            clearTimeout(timer);
        }
        if (!response.ok) {
            const errorBody = await response.text();
            // Honour Retry-After when ShipEngine throttles us (429/503). The header
            // is either delta-seconds or an HTTP-date; we only parse delta-seconds.
            const retryAfterHeader = response.headers.get('retry-after');
            const retryAfterSeconds = retryAfterHeader
                ? Number.parseInt(retryAfterHeader, 10)
                : NaN;
            const retryAfterMs = Number.isFinite(retryAfterSeconds)
                ? retryAfterSeconds * 1000
                : null;
            throw Object.assign(new ShipEngineHttpError(response.status, `ShipEngine API error (${response.status}): ${errorBody}`), { retryAfterMs });
        }
        return { result: (await response.json()), retryAfterMs: null };
    }
    /**
     * Issues a request with bounded timeout and exponential backoff.
     *
     * Retries ONLY on transient failures (429, 5xx, network/timeout) and honours
     * the `Retry-After` header. Non-retryable failures (4xx other than 429)
     * bubble up immediately.
     *
     * `allowRetry` defaults to true. `createLabel` MUST pass `false`: ShipEngine
     * label creation is NOT idempotent here (no client-supplied idempotency key),
     * so a retry after a timeout could purchase a second paid label. Stuck labels
     * are instead recovered by the `sweepPendingLabels` job.
     */
    async request(method, endpoint, body, allowRetry = true) {
        const url = `${this.config.baseUrl}${endpoint}`;
        const maxRetries = allowRetry ? RETRY_BACKOFF_MS.length : 0;
        let lastError;
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                const { result } = await this.requestOnce(method, url, body);
                return result;
            }
            catch (err) {
                lastError = err;
                const isHttp = err instanceof ShipEngineHttpError;
                const status = isHttp ? err.status : null;
                // Network/timeout errors have no status → treated as retryable.
                const isRetryable = status === null || RETRYABLE_STATUSES.has(status);
                if (!allowRetry || attempt === maxRetries || !isRetryable) {
                    throw err;
                }
                const retryAfterMs = err === null || err === void 0 ? void 0 : err.retryAfterMs;
                const delayMs = typeof retryAfterMs === 'number' && retryAfterMs > 0
                    ? retryAfterMs
                    : RETRY_BACKOFF_MS[attempt];
                // Intentionally not using functions/logger here to avoid a circular
                // import; this is a config-layer module. Callers log domain context.
                await sleep(delayMs);
            }
        }
        // Unreachable in practice (loop either returns or throws), but satisfies TS.
        throw lastError instanceof Error
            ? lastError
            : new Error('ShipEngine request failed');
    }
    // ===========================================================================
    // RATE SHOPPING — Compare Intelcom + Canada Post rates
    // ===========================================================================
    async getRates(shipFrom, shipTo, parcel) {
        var _a;
        const response = await this.request('POST', '/v1/rates', {
            // Omit rate_options.carrier_ids to use ALL connected carriers in the
            // ShipEngine account. An empty array [] means "no carriers" and returns
            // zero rates — the opposite of what we want.
            shipment: {
                ship_from: {
                    name: shipFrom.name,
                    address_line1: shipFrom.addressLine1,
                    address_line2: shipFrom.addressLine2,
                    city_locality: shipFrom.cityLocality,
                    state_province: shipFrom.stateProvince,
                    postal_code: shipFrom.postalCode,
                    country_code: shipFrom.countryCode,
                    phone: shipFrom.phone,
                },
                ship_to: {
                    name: shipTo.name,
                    address_line1: shipTo.addressLine1,
                    address_line2: shipTo.addressLine2,
                    city_locality: shipTo.cityLocality,
                    state_province: shipTo.stateProvince,
                    postal_code: shipTo.postalCode,
                    country_code: shipTo.countryCode,
                    phone: shipTo.phone,
                },
                packages: [
                    {
                        weight: parcel.weight,
                        dimensions: parcel.dimensions,
                    },
                ],
            },
        });
        return (((_a = response.rate_response) === null || _a === void 0 ? void 0 : _a.rates) || []).map((rate) => ({
            rateId: rate.rate_id,
            carrierId: rate.carrier_id,
            carrierCode: rate.carrier_code,
            carrierFriendlyName: rate.carrier_friendly_name,
            serviceCode: rate.service_code,
            serviceType: rate.service_type,
            shippingAmount: rate.shipping_amount,
            estimatedDeliveryDays: rate.estimated_delivery_days,
            deliveryType: 'home',
        }));
    }
    // ===========================================================================
    // LABEL CREATION — Purchase a shipping label from the selected rate
    // ===========================================================================
    async createLabel(rateId) {
        var _a, _b;
        const response = await this.request('POST', '/v1/labels', {
            rate_id: rateId,
            label_format: 'pdf',
            label_layout: '4x6',
        }, 
        // allowRetry = false: label creation is NOT idempotent (no idempotency
        // key supported here). A retry after a timeout could buy a 2nd paid
        // label. Stuck labels are recovered by the sweepPendingLabels job.
        false);
        return {
            labelId: response.label_id,
            trackingNumber: response.tracking_number,
            labelDownload: response.label_download,
            trackingUrl: this.getTrackingUrl(response.carrier_code, response.tracking_number),
            carrierCode: response.carrier_code,
            shipmentCost: typeof ((_a = response.shipment_cost) === null || _a === void 0 ? void 0 : _a.amount) === 'number'
                ? response.shipment_cost.amount
                : 0,
            insuranceCost: typeof ((_b = response.insurance_cost) === null || _b === void 0 ? void 0 : _b.amount) === 'number'
                ? response.insurance_cost.amount
                : 0,
        };
    }
    // ===========================================================================
    // RETURN LABEL — Purchase a label for the reverse leg (buyer -> seller)
    // ===========================================================================
    /**
     * Creates a RETURN shipping label for the reverse direction (buyer ships the
     * item back to the seller). Unlike createLabel(rateId), a return has no
     * pre-quoted rate, so we buy a label directly from an inline shipment using
     * ShipEngine rate-shopping (`rate_options.service_code` omitted = let
     * ShipEngine pick the carrier/service for the route).
     *
     * Cost is billed to the platform account; who ultimately bears it (buyer by
     * default, seller if a dispute is ruled against them) is a business decision
     * applied downstream — this method only purchases the label.
     *
     * Like createLabel, allowRetry is false: label purchase is not idempotent.
     */
    async createReturnLabel(shipFrom, shipTo, parcel) {
        var _a, _b;
        const response = await this.request('POST', '/v1/labels', {
            shipment: {
                ship_from: {
                    name: shipFrom.name,
                    address_line1: shipFrom.addressLine1,
                    address_line2: shipFrom.addressLine2,
                    city_locality: shipFrom.cityLocality,
                    state_province: shipFrom.stateProvince,
                    postal_code: shipFrom.postalCode,
                    country_code: shipFrom.countryCode,
                    phone: shipFrom.phone,
                },
                ship_to: {
                    name: shipTo.name,
                    address_line1: shipTo.addressLine1,
                    address_line2: shipTo.addressLine2,
                    city_locality: shipTo.cityLocality,
                    state_province: shipTo.stateProvince,
                    postal_code: shipTo.postalCode,
                    country_code: shipTo.countryCode,
                    phone: shipTo.phone,
                },
                packages: [
                    {
                        weight: parcel.weight,
                        dimensions: parcel.dimensions,
                    },
                ],
            },
            label_format: 'pdf',
            label_layout: '4x6',
            // is_return_label tells the carrier this is a reverse-logistics label.
            is_return_label: true,
        }, 
        // allowRetry = false: label creation is NOT idempotent (no idempotency key).
        false);
        return {
            labelId: response.label_id,
            trackingNumber: response.tracking_number,
            labelDownload: response.label_download,
            trackingUrl: this.getTrackingUrl(response.carrier_code, response.tracking_number),
            carrierCode: response.carrier_code,
            shipmentCost: typeof ((_a = response.shipment_cost) === null || _a === void 0 ? void 0 : _a.amount) === 'number'
                ? response.shipment_cost.amount
                : 0,
            insuranceCost: typeof ((_b = response.insurance_cost) === null || _b === void 0 ? void 0 : _b.amount) === 'number'
                ? response.insurance_cost.amount
                : 0,
        };
    }
    // ===========================================================================
    // TRACKING — Get shipment tracking info
    // ===========================================================================
    async getTracking(carrierCode, trackingNumber) {
        const response = await this.request('GET', `/v1/tracking?carrier_code=${carrierCode}&tracking_number=${trackingNumber}`);
        return {
            trackingNumber: response.tracking_number,
            statusCode: response.status_code,
            statusDescription: response.status_description,
            estimatedDeliveryDate: response.estimated_delivery_date,
            events: (response.events || []).map((e) => ({
                occurredAt: e.occurred_at,
                description: e.description,
                cityLocality: e.city_locality,
                stateProvince: e.state_province,
            })),
        };
    }
    // ===========================================================================
    // PUDO — Find nearby pickup/drop-off locations
    // ===========================================================================
    async findPUDOLocations(postalCode, countryCode = 'CA', radiusKm = 10) {
        try {
            const response = await this.request('GET', `/v1/pudo/locations?postal_code=${postalCode}&country_code=${countryCode}&radius=${radiusKm}`);
            return (response.locations || []).map((loc) => ({
                locationId: loc.location_id,
                name: loc.name,
                address: {
                    addressLine1: loc.address.address_line1,
                    cityLocality: loc.address.city_locality,
                    stateProvince: loc.address.state_province,
                    postalCode: loc.address.postal_code,
                },
                carrierCode: loc.carrier_code,
                distanceKm: loc.distance_km,
            }));
        }
        catch (_a) {
            // PUDO search may not be supported for all carriers
            return [];
        }
    }
    // ===========================================================================
    // HELPERS
    // ===========================================================================
    /**
     * Build a public tracking URL for the customer
     */
    getTrackingUrl(carrierCode, trackingNumber) {
        const urls = {
            intelcom_ca: (tn) => `https://www.intelcom.ca/en/tracking?tracking-number=${tn}`,
            canada_post: (tn) => `https://www.canadapost-postescanada.ca/track-colis/en#/search?searchFor=${tn}`,
            ups_ca: (tn) => `https://www.ups.com/track?tracknum=${tn}&loc=en_CA`,
        };
        const builder = urls[carrierCode];
        return builder
            ? builder(trackingNumber)
            : `https://track.shipengine.com/${trackingNumber}`;
    }
    /**
     * Map ShipEngine status codes to our internal status codes
     */
    static mapStatus(shipEngineStatus) {
        const map = {
            UN: 'UNKNOWN',
            AC: 'TRANSIT',
            IT: 'IN_TRANSIT',
            DE: 'DELIVERED',
            EX: 'FAILURE',
            AT: 'TRANSIT',
            NY: 'TRANSIT',
        };
        return map[shipEngineStatus] || 'UNKNOWN';
    }
}
exports.ShipEngineClient = ShipEngineClient;
// =============================================================================
// SINGLETON
// =============================================================================
let shipEngineClient = null;
const getShipEngine = () => {
    const apiKey = process.env.SHIPENGINE_API_KEY;
    const baseUrl = process.env.SHIPENGINE_BASE_URL || 'https://api.shipengine.com';
    if (!shipEngineClient && apiKey) {
        shipEngineClient = new ShipEngineClient({ apiKey, baseUrl });
    }
    return shipEngineClient;
};
exports.getShipEngine = getShipEngine;
//# sourceMappingURL=shipEngine.js.map