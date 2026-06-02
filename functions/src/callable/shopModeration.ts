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
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { db, FieldValue } from '../config/firebase';
import { sendPushNotification } from '../utils/notifications';

const REGION = 'northamerica-northeast1';

type ShopStatus = 'pending' | 'approved' | 'rejected' | 'suspended';

type ReportStatus = 'pending' | 'reviewed' | 'resolved' | 'dismissed';

const REPORT_OUTCOMES: ReadonlySet<ReportStatus> = new Set([
  'reviewed',
  'resolved',
  'dismissed',
]);

/**
 * Admin guard — SAME mechanism as adminRefundTransaction / privacyIncidents:
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

/** Owner info needed to notify after a status change. */
type ShopMutationResult = {
  ownerId: string | null;
  shopName: string | null;
};

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
async function mutateShopStatus(
  shopId: string,
  nextStatus: ShopStatus,
  adminUid: string,
  reason: string | null,
): Promise<ShopMutationResult> {
  return db.runTransaction(async (tx) => {
    const ref = db.collection('shops').doc(shopId);
    const snap = await tx.get(ref);
    if (!snap.exists) {
      throw new HttpsError('not-found', 'Boutique introuvable');
    }

    const data = snap.data() ?? {};
    const currentStatus = data.status as ShopStatus | undefined;
    if (currentStatus === nextStatus) {
      // Idempotent no-op: already in the requested state, no re-notify.
      return { ownerId: null, shopName: null };
    }

    const verificationDetails: Record<string, unknown> = {
      verifiedAt: FieldValue.serverTimestamp(),
      verifiedBy: adminUid,
    };
    // Only attach a reason when we actually have one (reject/suspend).
    if (reason !== null) {
      verificationDetails.reason = reason;
    }

    tx.update(ref, {
      status: nextStatus,
      verificationDetails,
      updatedAt: FieldValue.serverTimestamp(),
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
async function notifyShopOwner(
  result: ShopMutationResult,
  shopId: string,
  outcome: ShopStatus,
  reason: string | null,
): Promise<void> {
  if (!result.ownerId) {
    return; // idempotent no-op or missing owner — nothing to notify.
  }

  const shopLabel = result.shopName ?? 'Votre boutique';
  let type: string;
  let title: string;
  let message: string;
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
    await sendPushNotification(
      result.ownerId,
      title,
      message,
      { shopId },
      type,
    );
  } catch (error) {
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
function requireShopId(data: unknown): string {
  const shopId = (data as { shopId?: unknown } | null | undefined)?.shopId;
  if (typeof shopId !== 'string' || shopId.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'shopId is required');
  }
  return shopId.trim();
}

/**
 * Reads an optional `reason` string (bound 1-500 chars when present).
 * Returns the trimmed reason or null (never undefined).
 */
function readReason(data: unknown, required: boolean): string | null {
  const raw = (data as { reason?: unknown } | null | undefined)?.reason;
  if (raw === undefined || raw === null || raw === '') {
    if (required) {
      throw new HttpsError('invalid-argument', 'reason is required');
    }
    return null;
  }
  if (typeof raw !== 'string') {
    throw new HttpsError('invalid-argument', 'reason must be a string');
  }
  const trimmed = raw.trim();
  if (required && trimmed.length === 0) {
    throw new HttpsError('invalid-argument', 'reason is required');
  }
  if (trimmed.length > 500) {
    throw new HttpsError('invalid-argument', 'reason too long (max 500)');
  }
  return trimmed.length > 0 ? trimmed : null;
}

// ============================================================
// B2 — SHOP MODERATION (approve / reject / suspend)
// ============================================================

/**
 * approveShop — admin-only. Sets a shop's status to 'approved'.
 */
export const approveShop = onCall(
  { region: REGION, memory: '512MiB' },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentification requise');
    }
    await assertAdmin(request.auth.uid, request.auth.token.admin === true);

    const shopId = requireShopId(request.data);
    const result = await mutateShopStatus(
      shopId,
      'approved',
      request.auth.uid,
      null,
    );
    await notifyShopOwner(result, shopId, 'approved', null);

    logger.info('[approveShop] shop approved', {
      shopId,
      adminUid: request.auth.uid,
    });
    return { ok: true as const, shopId, status: 'approved' as const };
  },
);

/**
 * rejectShop — admin-only. Sets a shop's status to 'rejected' with a reason.
 */
export const rejectShop = onCall(
  { region: REGION, memory: '512MiB' },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentification requise');
    }
    await assertAdmin(request.auth.uid, request.auth.token.admin === true);

    const shopId = requireShopId(request.data);
    const reason = readReason(request.data, true);
    await mutateShopStatus(shopId, 'rejected', request.auth.uid, reason);

    logger.info('[rejectShop] shop rejected', {
      shopId,
      adminUid: request.auth.uid,
    });
    return { ok: true as const, shopId, status: 'rejected' as const };
  },
);

/**
 * suspendShop — admin-only. Sets a shop's status to 'suspended' with a reason.
 */
export const suspendShop = onCall(
  { region: REGION, memory: '512MiB' },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentification requise');
    }
    await assertAdmin(request.auth.uid, request.auth.token.admin === true);

    const shopId = requireShopId(request.data);
    const reason = readReason(request.data, true);
    await mutateShopStatus(shopId, 'suspended', request.auth.uid, reason);

    logger.info('[suspendShop] shop suspended', {
      shopId,
      adminUid: request.auth.uid,
    });
    return { ok: true as const, shopId, status: 'suspended' as const };
  },
);

// ============================================================
// B3 — REPORT TRIAGE
// ============================================================

/**
 * getPendingReports — admin-only. Lists open reports (status == 'pending'),
 * most recent first. Requires the reports(status ASC, createdAt DESC)
 * composite index (firestore.indexes.json).
 */
export const getPendingReports = onCall(
  { region: REGION, memory: '512MiB' },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentification requise');
    }
    await assertAdmin(request.auth.uid, request.auth.token.admin === true);

    const rawLimit = (request.data as { limit?: unknown } | null | undefined)?.limit;
    const limit =
      typeof rawLimit === 'number' && rawLimit > 0 ? Math.min(rawLimit, 200) : 100;

    const snap = await db
      .collection('reports')
      .where('status', '==', 'pending')
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get();

    const reports = snap.docs.map((d) => {
      const data = d.data();
      const createdAt = data.createdAt;
      return {
        id: d.id,
        reporterId: data.reporterId ?? null,
        reporterName: data.reporterName ?? null,
        targetType: data.targetType ?? null,
        targetId: data.targetId ?? null,
        targetOwnerId: data.targetOwnerId ?? null,
        reason: data.reason ?? null,
        description: data.description ?? null,
        status: data.status ?? 'pending',
        createdAt:
          createdAt && typeof createdAt.toDate === 'function'
            ? createdAt.toDate().toISOString()
            : null,
      };
    });

    return { ok: true as const, reports, count: reports.length };
  },
);

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
export const triageReport = onCall(
  { region: REGION, memory: '512MiB' },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentification requise');
    }
    await assertAdmin(request.auth.uid, request.auth.token.admin === true);

    const data = (request.data ?? {}) as {
      reportId?: unknown;
      outcome?: unknown;
      resolution?: unknown;
    };

    if (typeof data.reportId !== 'string' || data.reportId.trim().length === 0) {
      throw new HttpsError('invalid-argument', 'reportId is required');
    }
    if (
      typeof data.outcome !== 'string' ||
      !REPORT_OUTCOMES.has(data.outcome as ReportStatus)
    ) {
      throw new HttpsError(
        'invalid-argument',
        'outcome must be one of reviewed | resolved | dismissed',
      );
    }
    let resolution: string | null = null;
    if (
      data.resolution !== undefined &&
      data.resolution !== null &&
      data.resolution !== ''
    ) {
      if (typeof data.resolution !== 'string') {
        throw new HttpsError('invalid-argument', 'resolution must be a string');
      }
      const trimmed = data.resolution.trim();
      if (trimmed.length > 500) {
        throw new HttpsError('invalid-argument', 'resolution too long (max 500)');
      }
      resolution = trimmed.length > 0 ? trimmed : null;
    }

    const reportId = data.reportId.trim();
    const outcome = data.outcome as ReportStatus;
    const adminUid = request.auth.uid;

    await db.runTransaction(async (tx) => {
      const ref = db.collection('reports').doc(reportId);
      const snap = await tx.get(ref);
      if (!snap.exists) {
        throw new HttpsError('not-found', 'Signalement introuvable');
      }

      const update: Record<string, unknown> = {
        status: outcome,
        reviewedBy: adminUid,
        reviewedAt: FieldValue.serverTimestamp(),
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
    return { ok: true as const, reportId, status: outcome };
  },
);
