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
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { db, FieldValue } from '../config/firebase';
import { createInAppNotification } from '../utils/notifications';

const REGION = 'northamerica-northeast1';

type IncidentSeverity = 'low' | 'medium' | 'high' | 'critical';
type IncidentStatus = 'open' | 'investigating' | 'contained' | 'resolved';

const SEVERITIES: ReadonlySet<IncidentSeverity> = new Set([
  'low',
  'medium',
  'high',
  'critical',
]);
const STATUSES: ReadonlySet<IncidentStatus> = new Set([
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
async function assertAdmin(uid: string, claimAdmin: boolean): Promise<void> {
  let isAdmin = claimAdmin === true;
  if (!isAdmin) {
    const adminSnap = await db.collection('users').doc(uid).get();
    isAdmin = adminSnap.exists && adminSnap.data()?.isAdmin === true;
  }
  if (!isAdmin) {
    throw new HttpsError('permission-denied', 'Admin privileges required');
  }
}

export interface RecordPrivacyIncidentInput {
  type: string;
  severity?: IncidentSeverity;
  description: string;
  affectedUserIds?: string[];
  affectedDataFields?: string[];
  measures?: string;
  notifiedCAI?: boolean;
  status?: IncidentStatus;
}

/**
 * Internal helper: writes a privacy_incidents doc with a serverTimestamp.
 * Never throws — best-effort logging used by automated handlers. Returns the
 * created doc id, or null on failure (which is itself logged).
 *
 * Never writes `undefined` into Firestore (omits absent optional fields).
 */
export async function recordPrivacyIncident(
  input: RecordPrivacyIncidentInput,
): Promise<string | null> {
  try {
    const doc: Record<string, unknown> = {
      type: input.type,
      severity: SEVERITIES.has(input.severity as IncidentSeverity)
        ? input.severity
        : 'medium',
      description: input.description,
      affectedUserIds: Array.isArray(input.affectedUserIds) ? input.affectedUserIds : [],
      affectedDataFields: Array.isArray(input.affectedDataFields)
        ? input.affectedDataFields
        : [],
      measures: typeof input.measures === 'string' ? input.measures : '',
      notifiedCAI: input.notifiedCAI === true,
      status: STATUSES.has(input.status as IncidentStatus) ? input.status : 'open',
      detectedAt: FieldValue.serverTimestamp(),
    };
    const ref = await db.collection('privacy_incidents').add(doc);
    logger.warn('[privacy_incidents] incident recorded', {
      incidentId: ref.id,
      type: doc.type,
      severity: doc.severity,
    });
    return ref.id;
  } catch (error: unknown) {
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
export const reportPrivacyIncident = onCall({ region: REGION, memory: '512MiB' }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentification requise');
  }
  await assertAdmin(request.auth.uid, request.auth.token.admin === true);

  const data = (request.data ?? {}) as Partial<RecordPrivacyIncidentInput>;

  if (typeof data.type !== 'string' || data.type.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'type is required');
  }
  if (typeof data.description !== 'string' || data.description.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'description is required');
  }
  if (data.severity !== undefined && !SEVERITIES.has(data.severity)) {
    throw new HttpsError('invalid-argument', 'invalid severity');
  }
  if (data.status !== undefined && !STATUSES.has(data.status)) {
    throw new HttpsError('invalid-argument', 'invalid status');
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
    throw new HttpsError('internal', "Échec de l'enregistrement de l'incident");
  }

  logger.warn('[reportPrivacyIncident] incident created by admin', {
    incidentId,
    adminUid: request.auth.uid,
    type: data.type,
  });

  return { ok: true as const, incidentId };
});

/**
 * getPrivacyIncidentsLog — admin-only callable returning the incident log,
 * sorted by detectedAt descending (most recent first).
 */
export const getPrivacyIncidentsLog = onCall({ region: REGION, memory: '512MiB' }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentification requise');
  }
  await assertAdmin(request.auth.uid, request.auth.token.admin === true);

  // Optional pagination cap; defaults to 200, hard-capped at 500.
  const rawLimit = (request.data ?? {}).limit;
  const limit = typeof rawLimit === 'number' && rawLimit > 0 ? Math.min(rawLimit, 500) : 200;

  const snap = await db
    .collection('privacy_incidents')
    .orderBy('detectedAt', 'desc')
    .limit(limit)
    .get();

  const incidents = snap.docs.map((d) => {
    const data = d.data();
    const detectedAt = data.detectedAt;
    return {
      id: d.id,
      type: data.type ?? null,
      severity: data.severity ?? null,
      description: data.description ?? null,
      affectedUserIds: data.affectedUserIds ?? [],
      affectedDataFields: data.affectedDataFields ?? [],
      measures: data.measures ?? '',
      notifiedCAI: data.notifiedCAI === true,
      status: data.status ?? null,
      // Serialize the Firestore Timestamp to ISO for the client.
      detectedAt:
        detectedAt && typeof detectedAt.toDate === 'function'
          ? detectedAt.toDate().toISOString()
          : null,
    };
  });

  return { ok: true as const, incidents, count: incidents.length };
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
export const escalatePrivacyIncidentToCAI = onCall(
  { region: REGION, memory: '512MiB' },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentification requise');
    }
    await assertAdmin(request.auth.uid, request.auth.token.admin === true);

    const data = (request.data ?? {}) as { incidentId?: unknown; caiReference?: unknown };

    if (typeof data.incidentId !== 'string' || data.incidentId.trim().length === 0) {
      throw new HttpsError('invalid-argument', 'incidentId is required');
    }
    if (
      data.caiReference !== undefined &&
      data.caiReference !== null &&
      typeof data.caiReference !== 'string'
    ) {
      throw new HttpsError('invalid-argument', 'caiReference must be a string');
    }

    const incidentId = data.incidentId.trim();
    const caiReference =
      typeof data.caiReference === 'string' && data.caiReference.trim().length > 0
        ? data.caiReference.trim()
        : null; // null, never undefined (Firestore rule).

    const ref = db.collection('privacy_incidents').doc(incidentId);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new HttpsError('not-found', 'Incident introuvable');
    }

    const current = (snap.data()?.status as IncidentStatus | undefined) ?? 'open';
    // Advance an 'open' incident to 'investigating'; never regress a more
    // advanced status ('contained'/'resolved' are kept as-is).
    const nextStatus: IncidentStatus = current === 'open' ? 'investigating' : current;

    await ref.update({
      notifiedCAI: true,
      notifiedCAIAt: FieldValue.serverTimestamp(),
      caiReference,
      status: nextStatus,
    });

    logger.warn('[escalatePrivacyIncidentToCAI] incident escalated to CAI', {
      incidentId,
      adminUid: request.auth.uid,
      caiReference,
      status: nextStatus,
    });

    return { ok: true as const, incidentId, status: nextStatus };
  },
);

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
export const notifyAffectedUsers = onCall(
  { region: REGION, memory: '512MiB' },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentification requise');
    }
    await assertAdmin(request.auth.uid, request.auth.token.admin === true);

    const data = (request.data ?? {}) as { incidentId?: unknown; message?: unknown };

    if (typeof data.incidentId !== 'string' || data.incidentId.trim().length === 0) {
      throw new HttpsError('invalid-argument', 'incidentId is required');
    }
    if (typeof data.message !== 'string' || data.message.trim().length === 0) {
      throw new HttpsError('invalid-argument', 'message is required');
    }

    const incidentId = data.incidentId.trim();
    const message = data.message.trim();

    const ref = db.collection('privacy_incidents').doc(incidentId);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new HttpsError('not-found', 'Incident introuvable');
    }

    const affectedUserIds: string[] = Array.isArray(snap.data()?.affectedUserIds)
      ? (snap.data()?.affectedUserIds as unknown[]).filter(
          (uid): uid is string => typeof uid === 'string' && uid.length > 0,
        )
      : [];

    if (affectedUserIds.length === 0) {
      throw new HttpsError(
        'failed-precondition',
        'Aucun utilisateur affecté à notifier',
      );
    }

    const title = 'Incident de confidentialité';
    let notified = 0;
    let failed = 0;

    // Best-effort fan-out: one user's failure must not block the others.
    for (const uid of affectedUserIds) {
      try {
        await createInAppNotification(uid, 'privacy_incident', title, message, {
          incidentId,
        });
        notified++;
      } catch (error: unknown) {
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
      notifiedUsersAt: FieldValue.serverTimestamp(),
    });

    logger.warn('[notifyAffectedUsers] affected-user notification fan-out complete', {
      incidentId,
      adminUid: request.auth.uid,
      total: affectedUserIds.length,
      notified,
      failed,
    });

    return { ok: true as const, incidentId, notified, failed };
  },
);
