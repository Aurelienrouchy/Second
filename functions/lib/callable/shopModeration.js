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
exports.triageReport = exports.getPendingReports = exports.suspendShop = exports.rejectShop = exports.approveShop = void 0;
/**
 * Shop & Report Moderation — admin-only callables (B2 / B3).
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The client UI used to mutate a shop's validation `status` and a report's
 * moderation lifecycle directly via the Web SDK. firestore.rules (B1/B2/B3)
 * correctly LOCK those fields: a shop's `status`/`verificationDetails` and a
 * report's `status`/`reviewedBy`/`reviewedAt`/`resolution` are admin-owned and
 * the client write is rejected for a non-owner admin (and for the owner too).
 * So those mutations MUST go through Cloud Functions (Admin SDK bypasses rules)
 * with a server-side admin guard.
 *
 * B2 — approveShop / rejectShop / suspendShop:
 *   Mutate the shop validation status under runTransaction. Atomic read→check→
 *   write so two admins acting concurrently can't stomp each other and we never
 *   re-stamp `verificationDetails` from stale data.
 *
 * B3 — triageReport:
 *   The `reports` collection had no server-side processing. This callable lets
 *   an admin set a report's moderation outcome (reviewed/resolved/dismissed)
 *   and stamps `reviewedBy` / `reviewedAt` / `resolution`. getPendingReports
 *   lists open reports (needs the reports(status, createdAt) composite index
 *   added to firestore.indexes.json).
 *
 * All callables: v2, region northamerica-northeast1, memory 512MiB, structured
 * logging via firebase-functions/logger, never write `undefined` to Firestore.
 */
const https_1 = require("firebase-functions/v2/https");
const logger = __importStar(require("firebase-functions/logger"));
const firebase_1 = require("../config/firebase");
const REGION = 'northamerica-northeast1';
const REPORT_OUTCOMES = new Set([
    'reviewed',
    'resolved',
    'dismissed',
]);
/**
 * Admin guard — SAME mechanism as adminRefundTransaction / privacyIncidents:
 * custom claim `request.auth.token.admin === true` with a fallback to
 * `users/{uid}.isAdmin === true`. Throws HttpsError if not an admin.
 */
async function assertAdmin(uid, claimAdmin) {
    var _a;
    let isAdmin = claimAdmin === true;
    if (!isAdmin) {
        const adminSnap = await firebase_1.db.collection('users').doc(uid).get();
        isAdmin = adminSnap.exists && ((_a = adminSnap.data()) === null || _a === void 0 ? void 0 : _a.isAdmin) === true;
    }
    if (!isAdmin) {
        throw new https_1.HttpsError('permission-denied', 'Admin privileges required');
    }
}
/**
 * Internal helper: mutate a shop's validation status atomically.
 *
 * `verificationDetails` mirrors the shape the client service used to write
 * (reason? / verifiedAt / verifiedBy) so existing readers keep working. The
 * `reason` field is only set for reject/suspend (omitted entirely for approve —
 * never written as `undefined`).
 */
async function mutateShopStatus(shopId, nextStatus, adminUid, reason) {
    await firebase_1.db.runTransaction(async (tx) => {
        var _a;
        const ref = firebase_1.db.collection('shops').doc(shopId);
        const snap = await tx.get(ref);
        if (!snap.exists) {
            throw new https_1.HttpsError('not-found', 'Boutique introuvable');
        }
        const currentStatus = (_a = snap.data()) === null || _a === void 0 ? void 0 : _a.status;
        if (currentStatus === nextStatus) {
            // Idempotent no-op: already in the requested state.
            return;
        }
        const verificationDetails = {
            verifiedAt: firebase_1.FieldValue.serverTimestamp(),
            verifiedBy: adminUid,
        };
        // Only attach a reason when we actually have one (reject/suspend).
        if (reason !== null) {
            verificationDetails.reason = reason;
        }
        tx.update(ref, {
            status: nextStatus,
            verificationDetails,
            updatedAt: firebase_1.FieldValue.serverTimestamp(),
        });
    });
}
/**
 * Reads + validates a required `shopId` string from the callable payload.
 */
function requireShopId(data) {
    const shopId = data === null || data === void 0 ? void 0 : data.shopId;
    if (typeof shopId !== 'string' || shopId.trim().length === 0) {
        throw new https_1.HttpsError('invalid-argument', 'shopId is required');
    }
    return shopId.trim();
}
/**
 * Reads an optional `reason` string (bound 1-500 chars when present).
 * Returns the trimmed reason or null (never undefined).
 */
function readReason(data, required) {
    const raw = data === null || data === void 0 ? void 0 : data.reason;
    if (raw === undefined || raw === null || raw === '') {
        if (required) {
            throw new https_1.HttpsError('invalid-argument', 'reason is required');
        }
        return null;
    }
    if (typeof raw !== 'string') {
        throw new https_1.HttpsError('invalid-argument', 'reason must be a string');
    }
    const trimmed = raw.trim();
    if (required && trimmed.length === 0) {
        throw new https_1.HttpsError('invalid-argument', 'reason is required');
    }
    if (trimmed.length > 500) {
        throw new https_1.HttpsError('invalid-argument', 'reason too long (max 500)');
    }
    return trimmed.length > 0 ? trimmed : null;
}
// ============================================================
// B2 — SHOP MODERATION (approve / reject / suspend)
// ============================================================
/**
 * approveShop — admin-only. Sets a shop's status to 'approved'.
 */
exports.approveShop = (0, https_1.onCall)({ region: REGION, memory: '512MiB' }, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'Authentification requise');
    }
    await assertAdmin(request.auth.uid, request.auth.token.admin === true);
    const shopId = requireShopId(request.data);
    await mutateShopStatus(shopId, 'approved', request.auth.uid, null);
    logger.info('[approveShop] shop approved', {
        shopId,
        adminUid: request.auth.uid,
    });
    return { ok: true, shopId, status: 'approved' };
});
/**
 * rejectShop — admin-only. Sets a shop's status to 'rejected' with a reason.
 */
exports.rejectShop = (0, https_1.onCall)({ region: REGION, memory: '512MiB' }, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'Authentification requise');
    }
    await assertAdmin(request.auth.uid, request.auth.token.admin === true);
    const shopId = requireShopId(request.data);
    const reason = readReason(request.data, true);
    await mutateShopStatus(shopId, 'rejected', request.auth.uid, reason);
    logger.info('[rejectShop] shop rejected', {
        shopId,
        adminUid: request.auth.uid,
    });
    return { ok: true, shopId, status: 'rejected' };
});
/**
 * suspendShop — admin-only. Sets a shop's status to 'suspended' with a reason.
 */
exports.suspendShop = (0, https_1.onCall)({ region: REGION, memory: '512MiB' }, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'Authentification requise');
    }
    await assertAdmin(request.auth.uid, request.auth.token.admin === true);
    const shopId = requireShopId(request.data);
    const reason = readReason(request.data, true);
    await mutateShopStatus(shopId, 'suspended', request.auth.uid, reason);
    logger.info('[suspendShop] shop suspended', {
        shopId,
        adminUid: request.auth.uid,
    });
    return { ok: true, shopId, status: 'suspended' };
});
// ============================================================
// B3 — REPORT TRIAGE
// ============================================================
/**
 * getPendingReports — admin-only. Lists open reports (status == 'pending'),
 * most recent first. Requires the reports(status ASC, createdAt DESC)
 * composite index (firestore.indexes.json).
 */
exports.getPendingReports = (0, https_1.onCall)({ region: REGION, memory: '512MiB' }, async (request) => {
    var _a;
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'Authentification requise');
    }
    await assertAdmin(request.auth.uid, request.auth.token.admin === true);
    const rawLimit = (_a = request.data) === null || _a === void 0 ? void 0 : _a.limit;
    const limit = typeof rawLimit === 'number' && rawLimit > 0 ? Math.min(rawLimit, 200) : 100;
    const snap = await firebase_1.db
        .collection('reports')
        .where('status', '==', 'pending')
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .get();
    const reports = snap.docs.map((d) => {
        var _a, _b, _c, _d, _e, _f, _g, _h;
        const data = d.data();
        const createdAt = data.createdAt;
        return {
            id: d.id,
            reporterId: (_a = data.reporterId) !== null && _a !== void 0 ? _a : null,
            reporterName: (_b = data.reporterName) !== null && _b !== void 0 ? _b : null,
            targetType: (_c = data.targetType) !== null && _c !== void 0 ? _c : null,
            targetId: (_d = data.targetId) !== null && _d !== void 0 ? _d : null,
            targetOwnerId: (_e = data.targetOwnerId) !== null && _e !== void 0 ? _e : null,
            reason: (_f = data.reason) !== null && _f !== void 0 ? _f : null,
            description: (_g = data.description) !== null && _g !== void 0 ? _g : null,
            status: (_h = data.status) !== null && _h !== void 0 ? _h : 'pending',
            createdAt: createdAt && typeof createdAt.toDate === 'function'
                ? createdAt.toDate().toISOString()
                : null,
        };
    });
    return { ok: true, reports, count: reports.length };
});
/**
 * triageReport — admin-only. Records the moderation outcome of a report and
 * stamps the admin-owned review fields. Runs in a transaction so the outcome
 * is computed from the live doc (a report already resolved by another admin is
 * not silently re-stamped).
 *
 * Input:
 *   reportId     (string, required)
 *   outcome      ('reviewed' | 'resolved' | 'dismissed', required)
 *   resolution   (string, optional — bound 1-500; omitted when absent)
 */
exports.triageReport = (0, https_1.onCall)({ region: REGION, memory: '512MiB' }, async (request) => {
    var _a;
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'Authentification requise');
    }
    await assertAdmin(request.auth.uid, request.auth.token.admin === true);
    const data = ((_a = request.data) !== null && _a !== void 0 ? _a : {});
    if (typeof data.reportId !== 'string' || data.reportId.trim().length === 0) {
        throw new https_1.HttpsError('invalid-argument', 'reportId is required');
    }
    if (typeof data.outcome !== 'string' ||
        !REPORT_OUTCOMES.has(data.outcome)) {
        throw new https_1.HttpsError('invalid-argument', 'outcome must be one of reviewed | resolved | dismissed');
    }
    let resolution = null;
    if (data.resolution !== undefined &&
        data.resolution !== null &&
        data.resolution !== '') {
        if (typeof data.resolution !== 'string') {
            throw new https_1.HttpsError('invalid-argument', 'resolution must be a string');
        }
        const trimmed = data.resolution.trim();
        if (trimmed.length > 500) {
            throw new https_1.HttpsError('invalid-argument', 'resolution too long (max 500)');
        }
        resolution = trimmed.length > 0 ? trimmed : null;
    }
    const reportId = data.reportId.trim();
    const outcome = data.outcome;
    const adminUid = request.auth.uid;
    await firebase_1.db.runTransaction(async (tx) => {
        const ref = firebase_1.db.collection('reports').doc(reportId);
        const snap = await tx.get(ref);
        if (!snap.exists) {
            throw new https_1.HttpsError('not-found', 'Signalement introuvable');
        }
        const update = {
            status: outcome,
            reviewedBy: adminUid,
            reviewedAt: firebase_1.FieldValue.serverTimestamp(),
        };
        // Only write a resolution when provided (never undefined to Firestore).
        if (resolution !== null) {
            update.resolution = resolution;
        }
        tx.update(ref, update);
    });
    logger.info('[triageReport] report triaged', {
        reportId,
        outcome,
        adminUid,
    });
    return { ok: true, reportId, status: outcome };
});
//# sourceMappingURL=shopModeration.js.map