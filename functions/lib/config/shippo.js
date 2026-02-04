"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getShippo = void 0;
/**
 * Shippo client initialization
 * Firebase Functions v7
 */
const shippo_1 = require("shippo");
let shippoClient = null;
/**
 * Get Shippo client instance (lazy initialization)
 */
const getShippo = () => {
    const shippoApiKey = process.env.SHIPPO_API_KEY;
    if (!shippoClient && shippoApiKey) {
        shippoClient = new shippo_1.Shippo({ apiKeyHeader: shippoApiKey });
    }
    return shippoClient;
};
exports.getShippo = getShippo;
//# sourceMappingURL=shippo.js.map