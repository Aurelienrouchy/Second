"use strict";
/**
 * @deprecated Shippo has been replaced by Intelcom.
 * Use './intelcom' instead.
 * This file is kept only to avoid import errors during migration.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getShippo = void 0;
// Re-export from intelcom for backward compatibility
var intelcom_1 = require("./intelcom");
Object.defineProperty(exports, "getShippo", { enumerable: true, get: function () { return intelcom_1.getIntelcom; } });
//# sourceMappingURL=shippo.js.map