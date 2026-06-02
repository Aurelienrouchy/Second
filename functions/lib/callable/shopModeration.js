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
exports.submitReport = exports.triageReport = exports.getPendingReports = exports.suspendShop = exports.rejectShop = exports.approveShop = void 0;
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
const notifications_1 = require("../utils/notifications");
const REGION = 'northamerica-northeast1';
const REPORT_TARGET_TYPES = new Set([
    'user',
    'article',
    'message',
    'review',
]);
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
 *
 * Returns the shop owner's id + name so the caller can notify them server-side.
 * `ownerId` is `null` on an idempotent no-op (already in the requested state):
 * a replay of the same moderation action MUST NOT re-notify the owner.
 */
async function mutateShopStatus(shopId, nextStatus, adminUid, reason) {
    return firebase_1.db.runTransaction(async (tx) => {
        var _a;
        const ref = firebase_1.db.collection('shops').doc(shopId);
        const snap = await tx.get(ref);
        if (!snap.exists) {
            throw new https_1.HttpsError('not-found', 'Boutique introuvable');
        }
        const data = (_a = snap.data()) !== null && _a !== void 0 ? _a : {};
        const currentStatus = data.status;
        if (currentStatus === nextStatus) {
            // Idempotent no-op: already in the requested state, no re-notify.
            return { ownerId: null, shopName: null };
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
        const ownerId = typeof data.ownerId === 'string' ? data.ownerId : null;
        const shopName = typeof data.name === 'string' ? data.name : null;
        return { ownerId, shopName };
    });
}
/**
 * Notify a shop owner of a moderation outcome (in-app notification + FCM push,
 * created server-side via the Admin SDK — `notifications` create is locked to
 * Cloud Functions in firestore.rules, so the old client-side addDoc is gone).
 *
 * Best-effort: a notification failure must never roll back the (already
 * committed) status change, so we log and swallow. `shop_suspended` reuses the
 * `shop_rejected` client type (same negative outcome the notifications screen
 * already renders) to avoid an unmapped type.
 */
async function notifyShopOwner(result, shopId, outcome, reason) {
    var _a;
    if (!result.ownerId) {
        return; // idempotent no-op or missing owner — nothing to notify.
    }
    const shopLabel = (_a = result.shopName) !== null && _a !== void 0 ? _a : 'Votre boutique';
    let type;
    let title;
    let message;
    switch (outcome) {
        case 'approved':
            type = 'shop_approved';
            title = 'Boutique approuvée';
            message = `${shopLabel} a été approuvée et est maintenant en ligne.`;
            break;
        case 'rejected':
            type = 'shop_rejected';
            title = 'Boutique refusée';
            message = reason
                ? `${shopLabel} a été refusée : ${reason}`
                : `${shopLabel} a été refusée.`;
            break;
        case 'suspended':
            type = 'shop_rejected';
            title = 'Boutique suspendue';
            message = reason
                ? `${shopLabel} a été suspendue : ${reason}`
                : `${shopLabel} a été suspendue.`;
            break;
        default:
            return;
    }
    try {
        await (0, notifications_1.sendPushNotification)(result.ownerId, title, message, { shopId }, type);
    }
    catch (error) {
        logger.error('[shopModeration] failed to notify shop owner', {
            shopId,
            ownerId: result.ownerId,
            outcome,
            error: error instanceof Error ? error.message : String(error),
        });
    }
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
    const result = await mutateShopStatus(shopId, 'approved', request.auth.uid, null);
    await notifyShopOwner(result, shopId, 'approved', null);
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
    const result = await mutateShopStatus(shopId, 'rejected', request.auth.uid, reason);
    await notifyShopOwner(result, shopId, 'rejected', reason);
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
    const result = await mutateShopStatus(shopId, 'suspended', request.auth.uid, reason);
    await notifyShopOwner(result, shopId, 'suspended', reason);
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
// ============================================================
// B7 — REPORT SUBMISSION (anti-spam, server-side dedup)
// ============================================================
/**
 * submitReport — authenticated. Creates a moderation report for a target.
 *
 * ANTI-SPAM (Msg finding 39): the `reports` collection used to be created
 * client-side via addDoc, so a single reporter could spam unlimited reports
 * against the same target (a client-side hasUserReported() check is advisory
 * and racy). This callable enforces "1 report per reporter/target/type" with a
 * deterministic doc id (`${reporterId}_${targetType}_${targetId}`) checked
 * inside runTransaction — same atomic-dedup pattern as createReview. A replay
 * or repeated submission hits the existing doc and is rejected with
 * 'already-exists', so the client can map it to a "déjà signalé" message.
 *
 * Fields mirror the shape moderationService.createReport wrote and that
 * getPendingReports / the admin reports screen read (reporterId, reporterName,
 * targetType, targetId, targetOwnerId?, reason, description?, status,
 * createdAt). The moderation lifecycle (status/reviewedBy/reviewedAt/
 * resolution) stays admin-owned: the report always starts 'pending'.
 *
 * Input:
 *   targetType    ('user' | 'article' | 'message' | 'review', required)
 *   targetId      (string, required)
 *   reason        (string, required — ReportReason key, bound 1-100)
 *   description   (string, optional — bound 1-2000; omitted when absent)
 *   targetOwnerId (string, optional — omitted when absent)
 */
exports.submitReport = (0, https_1.onCall)({ region: REGION, memory: '512MiB' }, async (request) => {
    var _a, _b, _c, _d;
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'Authentification requise');
    }
    const reporterId = request.auth.uid;
    const data = ((_a = request.data) !== null && _a !== void 0 ? _a : {});
    if (typeof data.targetType !== 'string' ||
        !REPORT_TARGET_TYPES.has(data.targetType)) {
        throw new https_1.HttpsError('invalid-argument', 'targetType must be one of user | article | message | review');
    }
    if (typeof data.targetId !== 'string' || data.targetId.trim().length === 0) {
        throw new https_1.HttpsError('invalid-argument', 'targetId is required');
    }
    if (typeof data.reason !== 'string' ||
        data.reason.trim().length === 0 ||
        data.reason.trim().length > 100) {
        throw new https_1.HttpsError('invalid-argument', 'reason is required (max 100)');
    }
    const targetType = data.targetType;
    const targetId = data.targetId.trim();
    const reason = data.reason.trim();
    // Optional fields — never written as undefined to Firestore.
    let description = null;
    if (data.description !== undefined &&
        data.description !== null &&
        data.description !== '') {
        if (typeof data.description !== 'string') {
            throw new https_1.HttpsError('invalid-argument', 'description must be a string');
        }
        const trimmed = data.description.trim();
        if (trimmed.length > 2000) {
            throw new https_1.HttpsError('invalid-argument', 'description too long (max 2000)');
        }
        description = trimmed.length > 0 ? trimmed : null;
    }
    let targetOwnerId = null;
    if (data.targetOwnerId !== undefined &&
        data.targetOwnerId !== null &&
        data.targetOwnerId !== '') {
        if (typeof data.targetOwnerId !== 'string') {
            throw new https_1.HttpsError('invalid-argument', 'targetOwnerId must be a string');
        }
        const trimmed = data.targetOwnerId.trim();
        targetOwnerId = trimmed.length > 0 ? trimmed : null;
    }
    // Reporter display name (read-only, outside the transaction).
    const reporterSnap = await firebase_1.db.collection('users').doc(reporterId).get();
    const reporterName = (_d = (reporterSnap.exists && typeof ((_b = reporterSnap.data()) === null || _b === void 0 ? void 0 : _b.displayName) === 'string'
        ? (_c = reporterSnap.data()) === null || _c === void 0 ? void 0 : _c.displayName
        : null)) !== null && _d !== void 0 ? _d : 'Utilisateur';
    // Deterministic id enforces "1 per reporter/target/type" atomically:
    // concurrent or repeated submissions converge on the same doc and only the
    // first wins (existence checked inside the transaction).
    const reportId = `${reporterId}_${targetType}_${targetId}`;
    const ref = firebase_1.db.collection('reports').doc(reportId);
    await firebase_1.db.runTransaction(async (tx) => {
        const existing = await tx.get(ref);
        if (existing.exists) {
            throw new https_1.HttpsError('already-exists', 'Vous avez déjà signalé cet élément.');
        }
        const report = {
            id: reportId,
            reporterId,
            reporterName,
            targetType,
            targetId,
            reason,
            status: 'pending',
            createdAt: firebase_1.FieldValue.serverTimestamp(),
        };
        if (description !== null) {
            report.description = description;
        }
        if (targetOwnerId !== null) {
            report.targetOwnerId = targetOwnerId;
        }
        tx.set(ref, report);
    });
    logger.info('[submitReport] report created', {
        reportId,
        reporterId,
        targetType,
        targetId,
    });
    return { ok: true, reportId, status: 'pending' };
});
//# sourceMappingURL=shopModeration.js.map