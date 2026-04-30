/**
 * Intelcom (Dragonfly) API client
 * REST API integration for shipping, labels, and tracking
 * Documentation: https://developers.intelcomexpress.com/
 */

interface IntelcomConfig {
  apiKey: string;
  clientCode: string;
  baseUrl: string;
}

interface IntelcomRateRequest {
  originPostalCode: string;
  destinationPostalCode: string;
  weight: number; // kg
  length: number; // cm
  width: number; // cm
  height: number; // cm
  deliveryDate?: string; // ISO date string
}

interface IntelcomRate {
  serviceLevel: string;
  serviceName: string;
  amount: number;
  currency: string;
  estimatedDays: string;
  rateId: string;
}

interface IntelcomBookingRequest {
  clientCode: string;
  trackingNumberPrefix: string;
  parcels: {
    referenceNumber: string;
    recipient: {
      name: string;
      address: string;
      city: string;
      postalCode: string;
      province: string;
      country: string;
      phone?: string;
      email?: string;
    };
    sender: {
      name: string;
      address: string;
      city: string;
      postalCode: string;
      province: string;
      country: string;
      phone?: string;
    };
    weight: number; // kg
    length: number; // cm
    width: number; // cm
    height: number; // cm
    serviceLevel?: string;
    instructions?: string;
  }[];
}

interface IntelcomBookingResponse {
  code: string;
  msg: string;
  traceId: string;
  data: {
    accepted: {
      trackingNumber: string;
      referenceNumber: string;
      sortCode: string;
    }[];
    rejected: {
      referenceNumber: string;
      errorCode: string;
      errorMessage: string;
    }[];
  };
}

interface IntelcomLabelResponse {
  labelUrl: string;
  labelBase64?: string;
  format: string;
}

interface IntelcomTrackingResponse {
  trackingNumber: string;
  status: string;
  statusDescription: string;
  estimatedDeliveryDate?: string;
  events: {
    timestamp: string;
    status: string;
    description: string;
    location?: string;
  }[];
}

/**
 * Intelcom API client class
 * Handles all HTTP requests to Intelcom's REST API
 */
class IntelcomClient {
  private config: IntelcomConfig;

  constructor(config: IntelcomConfig) {
    this.config = config;
  }

  private async request<T>(
    method: string,
    endpoint: string,
    body?: unknown
  ): Promise<T> {
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
      throw new Error(
        `Intelcom API error (${response.status}): ${errorBody}`
      );
    }

    return response.json() as Promise<T>;
  }

  /**
   * Get delivery rates for a package
   * Uses the Intelcom Rate API
   */
  async getRates(params: IntelcomRateRequest): Promise<IntelcomRate[]> {
    const response = await this.request<{
      code: string;
      data: {
        rates: {
          serviceLevel: string;
          serviceName: string;
          price: number;
          currency: string;
          estimatedDays: number;
        }[];
      };
    }>('POST', '/v2/rates', {
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

    return (response.data?.rates || []).map((rate, index) => ({
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
  async createBooking(
    params: IntelcomBookingRequest
  ): Promise<IntelcomBookingResponse> {
    return this.request<IntelcomBookingResponse>('POST', '/v2/bookings', params);
  }

  /**
   * Generate a shipping label for a booked parcel
   * Uses the Intelcom Label API
   */
  async getLabel(
    trackingNumber: string,
    format: 'PDF' | 'PNG' = 'PDF'
  ): Promise<IntelcomLabelResponse> {
    return this.request<IntelcomLabelResponse>(
      'GET',
      `/v2/labels/${trackingNumber}?format=${format}`
    );
  }

  /**
   * Get tracking status for a parcel
   * Uses the Intelcom Tracking API
   */
  async getTracking(trackingNumber: string): Promise<IntelcomTrackingResponse> {
    return this.request<IntelcomTrackingResponse>(
      'GET',
      `/v2/tracking/${trackingNumber}`
    );
  }

  /**
   * Get tracking URL for customer-facing tracking page
   */
  getTrackingUrl(trackingNumber: string): string {
    return `https://www.intelcom.ca/en/tracking?tracking-number=${trackingNumber}`;
  }
}

// Singleton instance
let intelcomClient: IntelcomClient | null = null;

/**
 * Get Intelcom client instance (lazy initialization)
 */
export const getIntelcom = (): IntelcomClient | null => {
  const apiKey = process.env.INTELCOM_API_KEY;
  const clientCode = process.env.INTELCOM_CLIENT_CODE;
  const baseUrl =
    process.env.INTELCOM_BASE_URL || 'https://api.intelcomexpress.com';

  if (!intelcomClient && apiKey && clientCode) {
    intelcomClient = new IntelcomClient({ apiKey, clientCode, baseUrl });
  }

  return intelcomClient;
};

export { IntelcomClient };
export type {
  IntelcomConfig,
  IntelcomRateRequest,
  IntelcomRate,
  IntelcomBookingRequest,
  IntelcomBookingResponse,
  IntelcomLabelResponse,
  IntelcomTrackingResponse,
};
