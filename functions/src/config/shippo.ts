/**
 * Shippo client initialization
 * Firebase Functions v7
 */
import { Shippo } from 'shippo';

let shippoClient: Shippo | null = null;

/**
 * Get Shippo client instance (lazy initialization)
 */
export const getShippo = (): Shippo | null => {
  const shippoApiKey = process.env.SHIPPO_API_KEY;
  if (!shippoClient && shippoApiKey) {
    shippoClient = new Shippo({ apiKeyHeader: shippoApiKey });
  }
  return shippoClient;
};

export type { Shippo };
