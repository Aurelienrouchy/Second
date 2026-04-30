"use strict";
/**
 * Intelcom (Dragonfly) API client
 * REST API integration for shipping, labels, and tracking
 * Documentation: https://developers.intelcomexpress.com/
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.IntelcomClient = exports.getIntelcom = void 0;
/**
 * Intelcom API client class
 * Handles all HTTP requests to Intelcom's REST API
 */
class IntelcomClient {
    constructor(config) {
        this.config = config;
    }
    async request(method, endpoint, body) {
        const url = `${this.config.baseUrl}${endpoint}`;
        const response = await fetch(url, {
            method,
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                'x-api-key': this.config.apiKey,
                'x-client-code': this.config.clientCode,
            },
            body: body ? JSON.stringify(body) : undefined,
        });
        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(`Intelcom API error (${response.status}): ${errorBody}`);
        }
        return response.json();
    }
    /**
     * Get delivery rates for a package
     * Uses the Intelcom Rate API
     */
    async getRates(params) {
        var _a;
        const response = await this.request('POST', '/v2/rates', {
            originPostalCode: params.originPostalCode,
            destinationPostalCode: params.destinationPostalCode,
            parcel: {
                weight: params.weight,
                length: params.length,
                width: params.width,
                height: params.height,
            },
            deliveryDate: params.deliveryDate || new Date().toISOString().split('T')[0],
        });
        return (((_a = response.data) === null || _a === void 0 ? void 0 : _a.rates) || []).map((rate, index) => ({
            serviceLevel: rate.serviceLevel,
            serviceName: rate.serviceName,
            amount: rate.price,
            currency: rate.currency || 'CAD',
            estimatedDays: `${rate.estimatedDays}`,
            rateId: `${rate.serviceLevel}_${index}`,
        }));
    }
    /**
     * Create a booking (mandatory step before label generation)
     * Uses the Intelcom Booking API
     */
    async createBooking(params) {
        return this.request('POST', '/v2/bookings', params);
    }
    /**
     * Generate a shipping label for a booked parcel
     * Uses the Intelcom Label API
     */
    async getLabel(trackingNumber, format = 'PDF') {
        return this.request('GET', `/v2/labels/${trackingNumber}?format=${format}`);
    }
    /**
     * Get tracking status for a parcel
     * Uses the Intelcom Tracking API
     */
    async getTracking(trackingNumber) {
        return this.request('GET', `/v2/tracking/${trackingNumber}`);
    }
    /**
     * Get tracking URL for customer-facing tracking page
     */
    getTrackingUrl(trackingNumber) {
        return `https://www.intelcom.ca/en/tracking?tracking-number=${trackingNumber}`;
    }
}
exports.IntelcomClient = IntelcomClient;
// Singleton instance
let intelcomClient = null;
/**
 * Get Intelcom client instance (lazy initialization)
 */
const getIntelcom = () => {
    const apiKey = process.env.INTELCOM_API_KEY;
    const clientCode = process.env.INTELCOM_CLIENT_CODE;
    const baseUrl = process.env.INTELCOM_BASE_URL || 'https://api.intelcomexpress.com';
    if (!intelcomClient && apiKey && clientCode) {
        intelcomClient = new IntelcomClient({ apiKey, clientCode, baseUrl });
    }
    return intelcomClient;
};
exports.getIntelcom = getIntelcom;
//# sourceMappingURL=intelcom.js.map