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
class ShipEngineClient {
    constructor(config) {
        this.config = config;
    }
    async request(method, endpoint, body) {
        const url = `${this.config.baseUrl}${endpoint}`;
        const response = await fetch(url, {
            method,
            headers: {
                'Content-Type': 'application/json',
                'API-Key': this.config.apiKey,
            },
            body: body ? JSON.stringify(body) : undefined,
        });
        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(`ShipEngine API error (${response.status}): ${errorBody}`);
        }
        return response.json();
    }
    // ===========================================================================
    // RATE SHOPPING — Compare Intelcom + Canada Post rates
    // ===========================================================================
    async getRates(shipFrom, shipTo, parcel) {
        var _a;
        const response = await this.request('POST', '/v1/rates', {
            rate_options: {
                carrier_ids: [], // Uses all connected carriers
            },
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
        const response = await this.request('POST', '/v1/labels', {
            rate_id: rateId,
            label_format: 'pdf',
            label_layout: '4x6',
        });
        return {
            labelId: response.label_id,
            trackingNumber: response.tracking_number,
            labelDownload: response.label_download,
            trackingUrl: this.getTrackingUrl(response.carrier_code, response.tracking_number),
            carrierCode: response.carrier_code,
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