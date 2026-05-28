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
exports.cleanupExpiredDrafts = void 0;
/**
 * Scheduled cleanup of expired draft images from Firebase Storage
 * Firebase Functions v7 - using onSchedule
 *
 * Draft images are uploaded to `drafts/{draftId}/` during AI analysis.
 * If the user abandons the flow, these images are never cleaned up.
 * This function runs daily and deletes draft files older than 14 days.
 */
const scheduler_1 = require("firebase-functions/v2/scheduler");
const logger = __importStar(require("firebase-functions/logger"));
const firebase_1 = require("../config/firebase");
/** Draft expiration: 14 days (matches client-side draftService.ts) */
const DRAFT_EXPIRATION_MS = 14 * 24 * 60 * 60 * 1000;
exports.cleanupExpiredDrafts = (0, scheduler_1.onSchedule)({
    schedule: 'every 24 hours',
    timeZone: 'America/Toronto',
    region: 'northamerica-northeast1',
    memory: '512MiB',
}, async () => {
    const bucket = firebase_1.storage.bucket();
    const cutoff = Date.now() - DRAFT_EXPIRATION_MS;
    let deleted = 0;
    let errors = 0;
    try {
        const [files] = await bucket.getFiles({ prefix: 'drafts/' });
        logger.info(`Found ${files.length} files under drafts/`);
        for (const file of files) {
            try {
                const [metadata] = await file.getMetadata();
                const timeCreated = metadata.timeCreated;
                if (!timeCreated)
                    continue;
                const created = new Date(timeCreated).getTime();
                if (created < cutoff) {
                    await file.delete();
                    deleted++;
                }
            }
            catch (fileError) {
                errors++;
                logger.warn(`Failed to process file ${file.name}:`, fileError);
            }
        }
        logger.info(`Draft cleanup complete: ${deleted} expired files deleted, ${errors} errors`);
    }
    catch (error) {
        logger.error('Error during draft cleanup:', error);
    }
});
//# sourceMappingURL=cleanupDrafts.js.map