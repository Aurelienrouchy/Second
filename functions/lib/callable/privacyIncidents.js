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
exports.notifyAffectedUsers = exports.escalatePrivacyIncidentToCAI = exports.getPrivacyIncidentsLog = exports.reportPrivacyIncident = void 0;
exports.recordPrivacyIncident = recordPrivacyIncident;
/**
 * Privacy incident register callables
 * Firebase Functions v2 — region northamerica-northeast1
 *
 * Loi 25 (Québec) / RGPD breach-logging register. Incidents are stored in the
 * `privacy_incidents/{id}` collection, written EXCLUSIVELY server-side (Admin SDK)
 * and read by admins only (enforced by firestore.rules + the admin guard here).
 *
 * - reportPrivacyIncident      : admin-only, creates an incident doc (serverTimestamp).
 * - getPrivacyIncidentsLog     : admin-only, returns the incident log sorted by date.
 * - escalatePrivacyIncidentToCAI : admin-only, records CAI notification on an incident.
 * - notifyAffectedUsers        : admin-only, sends an in-app notice to affected users.
 *
 * The recordPrivacyIncident() helper is exported for internal server-side use
 * (e.g. automated deletion_failed logging from deleteUserAccount). It never
 * throws so it can never block the calling flow.
 *
 * ─── ESCALATION THRESHOLDS (Loi 25, art. 3.5 / "incident de confidentialité") ──
 *
 * The Commission d'accès à l'information (CAI) AND the affected individuals must
 * be notified whenever an incident presents a "risque de préjudice sérieux"
 * (serious harm risk). Technical anchoring of that legal duty:
 *
 *   - severity === 'critical' → CAI notification MANDATORY.
 *   - severity === 'high'     → CAI notification MANDATORY.
 *   - severity === 'medium'   → CAI notification at the privacy officer's
 *                                discretion (case-by-case harm assessment).
 *   - severity === 'low'      → register-only; no external notification.
 *
 * TARGET DELAY: CAI + affected-user notification must be issued WITHOUT UNDUE
 * DELAY, with a 72-hour target from detection (detectedAt → notifiedCAIAt /
 * notifiedUsersAt). The `escalatePrivacyIncidentToCAI` and `notifyAffectedUsers`
 * callables stamp those moments so the delay is auditable after the fact.
 */
const https_1 = require("firebase-functions/v2/https");
const logger = __importStar(require("firebase-functions/logger"));
const firebase_1 = require("../config/firebase");
const notifications_1 = require("../utils/notifications");
const REGION = 'northamerica-northeast1';
const SEVERITIES = new Set([
    'low',
    'medium',
    'high',
    'critical',
]);
const STATUSES = new Set([
    'open',
    'investigating',
    'contained',
    'resolved',
]);
/**
 * Admin guard — SAME mechanism as adminRefundTransaction:
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
 * Internal helper: writes a privacy_incidents doc with a serverTimestamp.
 * Never throws — best-effort logging used by automated handlers. Returns the
 * created doc id, or null on failure (which is itself logged).
 *
 * Never writes `undefined` into Firestore (omits absent optional fields).
 */
async function recordPrivacyIncident(input) {
    try {
        const doc = {
            type: input.type,
            severity: SEVERITIES.has(input.severity)
                ? input.severity
                : 'medium',
            description: input.description,
            affectedUserIds: Array.isArray(input.affectedUserIds) ? input.affectedUserIds : [],
            affectedDataFields: Array.isArray(input.affectedDataFields)
                ? input.affectedDataFields
                : [],
            measures: typeof input.measures === 'string' ? input.measures : '',
            notifiedCAI: input.notifiedCAI === true,
            status: STATUSES.has(input.status) ? input.status : 'open',
            detectedAt: firebase_1.FieldValue.serverTimestamp(),
        };
        const ref = await firebase_1.db.collection('privacy_incidents').add(doc);
        logger.warn('[privacy_incidents] incident recorded', {
            incidentId: ref.id,
            type: doc.type,
            severity: doc.severity,
        });
        return ref.id;
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        logger.error('[privacy_incidents] failed to record incident', {
            type: input.type,
            error: message,
        });
        return null;
    }
}
/**
 * reportPrivacyIncident — admin-only callable to log a privacy/security incident.
 */
exports.reportPrivacyIncident = (0, https_1.onCall)({ region: REGION, memory: '512MiB' }, async (request) => {
    var _a;
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'Authentification requise');
    }
    await assertAdmin(request.auth.uid, request.auth.token.admin === true);
    const data = ((_a = request.data) !== null && _a !== void 0 ? _a : {});
    if (typeof data.type !== 'string' || data.type.trim().length === 0) {
        throw new https_1.HttpsError('invalid-argument', 'type is required');
    }
    if (typeof data.description !== 'string' || data.description.trim().length === 0) {
        throw new https_1.HttpsError('invalid-argument', 'description is required');
    }
    if (data.severity !== undefined && !SEVERITIES.has(data.severity)) {
        throw new https_1.HttpsError('invalid-argument', 'invalid severity');
    }
    if (data.status !== undefined && !STATUSES.has(data.status)) {
        throw new https_1.HttpsError('invalid-argument', 'invalid status');
    }
    const incidentId = await recordPrivacyIncident({
        type: data.type.trim(),
        severity: data.severity,
        description: data.description.trim(),
        affectedUserIds: data.affectedUserIds,
        affectedDataFields: data.affectedDataFields,
        measures: data.measures,
        notifiedCAI: data.notifiedCAI,
        status: data.status,
    });
    if (!incidentId) {
        throw new https_1.HttpsError('internal', "Échec de l'enregistrement de l'incident");
    }
    logger.warn('[reportPrivacyIncident] incident created by admin', {
        incidentId,
        adminUid: request.auth.uid,
        type: data.type,
    });
    return { ok: true, incidentId };
});
/**
 * getPrivacyIncidentsLog — admin-only callable returning the incident log,
 * sorted by detectedAt descending (most recent first).
 */
exports.getPrivacyIncidentsLog = (0, https_1.onCall)({ region: REGION, memory: '512MiB' }, async (request) => {
    var _a;
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'Authentification requise');
    }
    await assertAdmin(request.auth.uid, request.auth.token.admin === true);
    // Optional pagination cap; defaults to 200, hard-capped at 500.
    const rawLimit = ((_a = request.data) !== null && _a !== void 0 ? _a : {}).limit;
    const limit = typeof rawLimit === 'number' && rawLimit > 0 ? Math.min(rawLimit, 500) : 200;
    const snap = await firebase_1.db
        .collection('privacy_incidents')
        .orderBy('detectedAt', 'desc')
        .limit(limit)
        .get();
    const incidents = snap.docs.map((d) => {
        var _a, _b, _c, _d, _e, _f, _g;
        const data = d.data();
        const detectedAt = data.detectedAt;
        return {
            id: d.id,
            type: (_a = data.type) !== null && _a !== void 0 ? _a : null,
            severity: (_b = data.severity) !== null && _b !== void 0 ? _b : null,
            description: (_c = data.description) !== null && _c !== void 0 ? _c : null,
            affectedUserIds: (_d = data.affectedUserIds) !== null && _d !== void 0 ? _d : [],
            affectedDataFields: (_e = data.affectedDataFields) !== null && _e !== void 0 ? _e : [],
            measures: (_f = data.measures) !== null && _f !== void 0 ? _f : '',
            notifiedCAI: data.notifiedCAI === true,
            status: (_g = data.status) !== null && _g !== void 0 ? _g : null,
            // Serialize the Firestore Timestamp to ISO for the client.
            detectedAt: detectedAt && typeof detectedAt.toDate === 'function'
                ? detectedAt.toDate().toISOString()
                : null,
        };
    });
    return { ok: true, incidents, count: incidents.length };
});
/**
 * escalatePrivacyIncidentToCAI — admin-only callable that records the
 * notification of the Commission d'accès à l'information (CAI) for a given
 * incident, per the escalation thresholds documented in the file header
 * (critical/high → CAI mandatory; 72h target delay from detection).
 *
 * Effects on the incident doc:
 *   - notifiedCAI    = true
 *   - notifiedCAIAt  = serverTimestamp() (auditable escalation timestamp)
 *   - caiReference   = provided reference, or null if omitted (never undefined)
 *   - status         → 'investigating' if currently 'open'; otherwise preserved
 *                      (an already 'contained'/'resolved' incident keeps its
 *                      more advanced status — we never regress it).
 *
 * Refuses (`not-found`) if the incident does not exist.
 */
exports.escalatePrivacyIncidentToCAI = (0, https_1.onCall)({ region: REGION, memory: '512MiB' }, async (request) => {
    var _a, _b, _c;
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'Authentification requise');
    }
    await assertAdmin(request.auth.uid, request.auth.token.admin === true);
    const data = ((_a = request.data) !== null && _a !== void 0 ? _a : {});
    if (typeof data.incidentId !== 'string' || data.incidentId.trim().length === 0) {
        throw new https_1.HttpsError('invalid-argument', 'incidentId is required');
    }
    if (data.caiReference !== undefined &&
        data.caiReference !== null &&
        typeof data.caiReference !== 'string') {
        throw new https_1.HttpsError('invalid-argument', 'caiReference must be a string');
    }
    const incidentId = data.incidentId.trim();
    const caiReference = typeof data.caiReference === 'string' && data.caiReference.trim().length > 0
        ? data.caiReference.trim()
        : null; // null, never undefined (Firestore rule).
    const ref = firebase_1.db.collection('privacy_incidents').doc(incidentId);
    const snap = await ref.get();
    if (!snap.exists) {
        throw new https_1.HttpsError('not-found', 'Incident introuvable');
    }
    const current = (_c = (_b = snap.data()) === null || _b === void 0 ? void 0 : _b.status) !== null && _c !== void 0 ? _c : 'open';
    // Advance an 'open' incident to 'investigating'; never regress a more
    // advanced status ('contained'/'resolved' are kept as-is).
    const nextStatus = current === 'open' ? 'investigating' : current;
    await ref.update({
        notifiedCAI: true,
        notifiedCAIAt: firebase_1.FieldValue.serverTimestamp(),
        caiReference,
        status: nextStatus,
    });
    logger.warn('[escalatePrivacyIncidentToCAI] incident escalated to CAI', {
        incidentId,
        adminUid: request.auth.uid,
        caiReference,
        status: nextStatus,
    });
    return { ok: true, incidentId, status: nextStatus };
});
/**
 * notifyAffectedUsers — admin-only callable that pushes an in-app notice to
 * every user listed in the incident's `affectedUserIds`, per the affected-user
 * notification duty (Loi 25, 72h target). Best-effort PER USER: a failure for
 * one user is logged and does not abort the others.
 *
 * Uses the dedicated 'privacy_incident' notification type (see notifications.ts
 * deep-link/channel maps). Stamps `notifiedUsersAt` on the incident once the
 * fan-out completes.
 *
 * Refuses (`not-found`) if the incident does not exist; (`failed-precondition`)
 * if there are no affected users to notify.
 */
exports.notifyAffectedUsers = (0, https_1.onCall)({ region: REGION, memory: '512MiB' }, async (request) => {
    var _a, _b, _c;
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'Authentification requise');
    }
    await assertAdmin(request.auth.uid, request.auth.token.admin === true);
    const data = ((_a = request.data) !== null && _a !== void 0 ? _a : {});
    if (typeof data.incidentId !== 'string' || data.incidentId.trim().length === 0) {
        throw new https_1.HttpsError('invalid-argument', 'incidentId is required');
    }
    if (typeof data.message !== 'string' || data.message.trim().length === 0) {
        throw new https_1.HttpsError('invalid-argument', 'message is required');
    }
    const incidentId = data.incidentId.trim();
    const message = data.message.trim();
    const ref = firebase_1.db.collection('privacy_incidents').doc(incidentId);
    const snap = await ref.get();
    if (!snap.exists) {
        throw new https_1.HttpsError('not-found', 'Incident introuvable');
    }
    const affectedUserIds = Array.isArray((_b = snap.data()) === null || _b === void 0 ? void 0 : _b.affectedUserIds)
        ? ((_c = snap.data()) === null || _c === void 0 ? void 0 : _c.affectedUserIds).filter((uid) => typeof uid === 'string' && uid.length > 0)
        : [];
    if (affectedUserIds.length === 0) {
        throw new https_1.HttpsError('failed-precondition', 'Aucun utilisateur affecté à notifier');
    }
    const title = 'Incident de confidentialité';
    let notified = 0;
    let failed = 0;
    // Best-effort fan-out: one user's failure must not block the others.
    for (const uid of affectedUserIds) {
        try {
            await (0, notifications_1.createInAppNotification)(uid, 'privacy_incident', title, message, {
                incidentId,
            });
            notified++;
        }
        catch (error) {
            failed++;
            const errMessage = error instanceof Error ? error.message : 'Unknown error';
            logger.error('[notifyAffectedUsers] failed to notify user', {
                incidentId,
                uid,
                error: errMessage,
            });
        }
    }
    await ref.update({
        notifiedUsersAt: firebase_1.FieldValue.serverTimestamp(),
    });
    logger.warn('[notifyAffectedUsers] affected-user notification fan-out complete', {
        incidentId,
        adminUid: request.auth.uid,
        total: affectedUserIds.length,
        notified,
        failed,
    });
    return { ok: true, incidentId, notified, failed };
});
//# sourceMappingURL=privacyIncidents.js.map