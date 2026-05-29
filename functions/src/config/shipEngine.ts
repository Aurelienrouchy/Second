/**
 * ShipEngine API client
 * Multi-carrier shipping: Intelcom (Dragonfly) + Canada Post
 * Documentation: https://www.shipengine.com/docs/
 *
 * ShipEngine wraps multiple carriers behind a single API.
 * We use it for: rate shopping, label creation, tracking, PUDO locations.
 */

// =============================================================================
// TYPES
// =============================================================================

interface ShipEngineConfig {
  apiKey: string;
  baseUrl: string;
}

export interface ShipEngineAddress {
  name: string;
  addressLine1: string;
  addressLine2?: string;
  cityLocality: string;
  stateProvince: string;
  postalCode: string;
  countryCode: string;
  phone?: string;
  email?: string;
}

export interface ShipEngineParcel {
  weight: { value: number; unit: 'kilogram' };
  dimensions: {
    length: number;
    width: number;
    height: number;
    unit: 'centimeter';
  };
}

export interface ShipEngineRate {
  rateId: string;
  carrierId: string;
  carrierCode: string;
  carrierFriendlyName: string;
  serviceCode: string;
  serviceType: string;
  shippingAmount: { amount: number; currency: string };
  estimatedDeliveryDays: number;
  deliveryType: 'home' | 'pickup_point';
  pickupPointId?: string;
  pickupPointName?: string;
}

export interface ShipEngineLabel {
  labelId: string;
  trackingNumber: string;
  labelDownload: { href: string };
  trackingUrl: string;
  carrierCode: string;
  /**
   * Real cost ShipEngine charged the platform for this label, in dollars.
   * Used by the cost-reconciliation pass (compare with the estimated
   * shippingCost billed to the buyer). 0 when ShipEngine omits the field.
   */
  shipmentCost: number;
  /** Real insurance cost in dollars (0 when no insurance was purchased). */
  insuranceCost: number;
}

export interface ShipEngineTracking {
  trackingNumber: string;
  statusCode: string;
  statusDescription: string;
  estimatedDeliveryDate?: string;
  events: {
    occurredAt: string;
    description: string;
    cityLocality?: string;
    stateProvince?: string;
  }[];
}

export interface PUDOLocation {
  locationId: string;
  name: string;
  address: {
    addressLine1: string;
    cityLocality: string;
    stateProvince: string;
    postalCode: string;
  };
  carrierCode: string;
  openHours?: string;
  distanceKm?: number;
}

// =============================================================================
// CLIENT
// =============================================================================

// Per-attempt network timeout. ShipEngine rate/label calls are normally well
// under a second; 15s is a generous ceiling that still lets the webhook handler
// respond before Stripe's retry window — a hung fetch would otherwise block the
// 200 response and trigger duplicate Stripe webhook deliveries (P1-17/P1-27).
const REQUEST_TIMEOUT_MS = 15_000;

// Exponential backoff schedule (ms) for transient failures. The number of
// entries also caps the number of RETRIES (so 3 here => up to 4 attempts).
const RETRY_BACKOFF_MS = [500, 1000, 2000];

// HTTP statuses worth retrying: 429 (rate limited) + 5xx (server-side).
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Error carrying the HTTP status so callers / the retry loop can branch on it.
 */
class ShipEngineHttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ShipEngineHttpError';
    this.status = status;
  }
}

class ShipEngineClient {
  private config: ShipEngineConfig;

  constructor(config: ShipEngineConfig) {
    this.config = config;
  }

  /**
   * Performs a single HTTP attempt with an AbortController timeout. Throws
   * `ShipEngineHttpError` on a non-OK response (carrying the status) and a
   * generic timeout/network Error otherwise.
   */
  private async requestOnce<T>(
    method: string,
    url: string,
    body: unknown
  ): Promise<{ result: T; retryAfterMs: number | null }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let response: Response;
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
    } catch (err) {
      // AbortError (timeout) or network failure — both transient/retryable.
      const message =
        err instanceof Error && err.name === 'AbortError'
          ? `ShipEngine request timed out after ${REQUEST_TIMEOUT_MS}ms`
          : `ShipEngine network error: ${err instanceof Error ? err.message : String(err)}`;
      throw new Error(message);
    } finally {
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
      throw Object.assign(
        new ShipEngineHttpError(
          response.status,
          `ShipEngine API error (${response.status}): ${errorBody}`
        ),
        { retryAfterMs }
      );
    }

    return { result: (await response.json()) as T, retryAfterMs: null };
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
  private async request<T>(
    method: string,
    endpoint: string,
    body?: unknown,
    allowRetry = true
  ): Promise<T> {
    const url = `${this.config.baseUrl}${endpoint}`;
    const maxRetries = allowRetry ? RETRY_BACKOFF_MS.length : 0;

    let lastError: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const { result } = await this.requestOnce<T>(method, url, body);
        return result;
      } catch (err) {
        lastError = err;

        const isHttp = err instanceof ShipEngineHttpError;
        const status = isHttp ? err.status : null;
        // Network/timeout errors have no status → treated as retryable.
        const isRetryable = status === null || RETRYABLE_STATUSES.has(status);

        if (!allowRetry || attempt === maxRetries || !isRetryable) {
          throw err;
        }

        const retryAfterMs = (err as { retryAfterMs?: number | null })?.retryAfterMs;
        const delayMs =
          typeof retryAfterMs === 'number' && retryAfterMs > 0
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

  async getRates(
    shipFrom: ShipEngineAddress,
    shipTo: ShipEngineAddress,
    parcel: ShipEngineParcel
  ): Promise<ShipEngineRate[]> {
    const response = await this.request<{
      rate_response: {
        rates: {
          rate_id: string;
          carrier_id: string;
          carrier_code: string;
          carrier_friendly_name: string;
          service_code: string;
          service_type: string;
          shipping_amount: { amount: number; currency: string };
          estimated_delivery_days: number;
        }[];
      };
    }>('POST', '/v1/rates', {
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

    return (response.rate_response?.rates || []).map((rate) => ({
      rateId: rate.rate_id,
      carrierId: rate.carrier_id,
      carrierCode: rate.carrier_code,
      carrierFriendlyName: rate.carrier_friendly_name,
      serviceCode: rate.service_code,
      serviceType: rate.service_type,
      shippingAmount: rate.shipping_amount,
      estimatedDeliveryDays: rate.estimated_delivery_days,
      deliveryType: 'home' as const,
    }));
  }

  // ===========================================================================
  // LABEL CREATION — Purchase a shipping label from the selected rate
  // ===========================================================================

  async createLabel(rateId: string): Promise<ShipEngineLabel> {
    const response = await this.request<{
      label_id: string;
      tracking_number: string;
      label_download: { href: string };
      carrier_code: string;
      // Real cost ShipEngine billed for the label (used for reconciliation).
      shipment_cost?: { amount: number; currency: string };
      insurance_cost?: { amount: number; currency: string };
    }>(
      'POST',
      '/v1/labels',
      {
        rate_id: rateId,
        label_format: 'pdf',
        label_layout: '4x6',
      },
      // allowRetry = false: label creation is NOT idempotent (no idempotency
      // key supported here). A retry after a timeout could buy a 2nd paid
      // label. Stuck labels are recovered by the sweepPendingLabels job.
      false
    );

    return {
      labelId: response.label_id,
      trackingNumber: response.tracking_number,
      labelDownload: response.label_download,
      trackingUrl: this.getTrackingUrl(
        response.carrier_code,
        response.tracking_number
      ),
      carrierCode: response.carrier_code,
      shipmentCost:
        typeof response.shipment_cost?.amount === 'number'
          ? response.shipment_cost.amount
          : 0,
      insuranceCost:
        typeof response.insurance_cost?.amount === 'number'
          ? response.insurance_cost.amount
          : 0,
    };
  }

  // ===========================================================================
  // TRACKING — Get shipment tracking info
  // ===========================================================================

  async getTracking(
    carrierCode: string,
    trackingNumber: string
  ): Promise<ShipEngineTracking> {
    const response = await this.request<{
      tracking_number: string;
      status_code: string;
      status_description: string;
      estimated_delivery_date?: string;
      events: {
        occurred_at: string;
        description: string;
        city_locality?: string;
        state_province?: string;
      }[];
    }>('GET', `/v1/tracking?carrier_code=${carrierCode}&tracking_number=${trackingNumber}`);

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

  async findPUDOLocations(
    postalCode: string,
    countryCode: string = 'CA',
    radiusKm: number = 10
  ): Promise<PUDOLocation[]> {
    try {
      const response = await this.request<{
        locations: {
          location_id: string;
          name: string;
          address: {
            address_line1: string;
            city_locality: string;
            state_province: string;
            postal_code: string;
          };
          carrier_code: string;
          distance_km?: number;
        }[];
      }>(
        'GET',
        `/v1/pudo/locations?postal_code=${postalCode}&country_code=${countryCode}&radius=${radiusKm}`
      );

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
    } catch {
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
  private getTrackingUrl(carrierCode: string, trackingNumber: string): string {
    const urls: Record<string, (tn: string) => string> = {
      intelcom_ca: (tn) =>
        `https://www.intelcom.ca/en/tracking?tracking-number=${tn}`,
      canada_post: (tn) =>
        `https://www.canadapost-postescanada.ca/track-colis/en#/search?searchFor=${tn}`,
      ups_ca: (tn) =>
        `https://www.ups.com/track?tracknum=${tn}&loc=en_CA`,
    };

    const builder = urls[carrierCode];
    return builder
      ? builder(trackingNumber)
      : `https://track.shipengine.com/${trackingNumber}`;
  }

  /**
   * Map ShipEngine status codes to our internal status codes
   */
  static mapStatus(shipEngineStatus: string): string {
    const map: Record<string, string> = {
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

// =============================================================================
// SINGLETON
// =============================================================================

let shipEngineClient: ShipEngineClient | null = null;

export const getShipEngine = (): ShipEngineClient | null => {
  const apiKey = process.env.SHIPENGINE_API_KEY;
  const baseUrl =
    process.env.SHIPENGINE_BASE_URL || 'https://api.shipengine.com';

  if (!shipEngineClient && apiKey) {
    shipEngineClient = new ShipEngineClient({ apiKey, baseUrl });
  }

  return shipEngineClient;
};

export { ShipEngineClient };
