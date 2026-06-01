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
exports.assignUsername = void 0;
exports.slugifyUsername = slugifyUsername;
/**
 * Username assignment callable.
 * Firebase Functions v2 (onCall) — region northamerica-northeast1, 512MiB.
 *
 * assignUsername: generates, reserves and persists the persistent, unique,
 * IMMUTABLE @handle for a user, atomically (runTransaction). Server-authoritative:
 *
 *   - The slug is derived from the user's displayName (transliterate accents,
 *     lowercase, spaces -> '.', strip illegal chars, collapse separators).
 *   - Uniqueness is enforced via the usernames/{username} registry. If the slug
 *     is taken, a numeric suffix (.2, .3, ...) is appended until a free one is
 *     found, all within the transaction.
 *   - IDEMPOTENT / IMMUTABLE: if users/{uid}.username already exists, it is
 *     returned as-is (no-op). The function can NEVER change an assigned username.
 *
 * SECURITY: usernames/{username} is written exclusively here (Admin SDK bypasses
 * the Firestore rules, which forbid all client access). The users/{uid}.username
 * field is in the protected set on the users rules (client cannot add/edit it).
 *
 * Call this right after the users/{uid} doc is created, for ALL providers
 * (email + Google + Apple). Auth required; the caller assigns their OWN username.
 */
const https_1 = require("firebase-functions/v2/https");
const logger = __importStar(require("firebase-functions/logger"));
const firebase_1 = require("../config/firebase");
const USERNAME_MIN_LEN = 3;
const USERNAME_MAX_LEN = 30;
// Max numeric suffixes to try before giving up (collision is astronomically
// unlikely; this just bounds the transaction work).
const MAX_SUFFIX_ATTEMPTS = 50;
/**
 * Transliterate common accented Latin characters to their ASCII equivalent.
 * Uses Unicode NFD normalization to strip combining diacritical marks, then a
 * few explicit mappings for letters that don't decompose (ø, æ, œ, ß, ...).
 */
function transliterate(input) {
    const stripped = input
        .normalize('NFD')
        // Remove combining diacritical marks (U+0300–U+036F).
        .replace(/[̀-ͯ]/g, '');
    const map = {
        æ: 'ae',
        Æ: 'ae',
        œ: 'oe',
        Œ: 'oe',
        ø: 'o',
        Ø: 'o',
        ß: 'ss',
        đ: 'd',
        Đ: 'd',
        ł: 'l',
        Ł: 'l',
        ı: 'i',
    };
    return stripped.replace(/[æÆœŒøØßđĐłŁı]/g, (ch) => { var _a; return (_a = map[ch]) !== null && _a !== void 0 ? _a : ch; });
}
/**
 * Build a deterministic fallback handle for degenerate displayNames.
 * `user.<6 hex chars derived from the uid>`, bounded to USERNAME_MAX_LEN.
 */
function fallbackSlug(uid) {
    const suffix = (uid || '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .slice(0, 6)
        .padEnd(6, '0');
    return `user.${suffix}`.slice(0, USERNAME_MAX_LEN);
}
/**
 * Derive a clean slug from displayName:
 *   transliterate -> lowercase -> spaces to '.' -> strip non [a-z0-9._-]
 *   -> collapse repeated separators -> trim border separators -> bound length.
 * Returns the fallback slug when the result is empty or too short.
 */
function slugifyUsername(displayName, uid) {
    const raw = typeof displayName === 'string' ? displayName : '';
    let slug = transliterate(raw)
        .toLowerCase()
        // Whitespace runs -> single dot.
        .replace(/\s+/g, '.')
        // Drop anything outside the allowed character class.
        .replace(/[^a-z0-9._-]/g, '')
        // Collapse runs of separators (., _, -) into a single dot.
        .replace(/[._-]{2,}/g, '.')
        // Trim leading/trailing separators.
        .replace(/^[._-]+/, '')
        .replace(/[._-]+$/, '');
    if (slug.length < USERNAME_MIN_LEN) {
        return fallbackSlug(uid);
    }
    // Bound max length, then re-trim a trailing separator the cut may have left.
    if (slug.length > USERNAME_MAX_LEN) {
        slug = slug.slice(0, USERNAME_MAX_LEN).replace(/[._-]+$/, '');
    }
    // Length could dip below the min after the trailing trim.
    if (slug.length < USERNAME_MIN_LEN) {
        return fallbackSlug(uid);
    }
    return slug;
}
/**
 * Append a numeric suffix to a base slug while respecting USERNAME_MAX_LEN.
 * e.g. ("marie.dupont", 2) -> "marie.dupont.2". If adding the suffix would
 * exceed the max length, the base is truncated to make room.
 */
function withSuffix(base, n) {
    const suffix = `.${n}`;
    if (base.length + suffix.length <= USERNAME_MAX_LEN) {
        return base + suffix;
    }
    const truncated = base
        .slice(0, USERNAME_MAX_LEN - suffix.length)
        .replace(/[._-]+$/, '');
    return truncated + suffix;
}
/**
 * assignUsername
 *
 * input  = {} (none — the username is derived server-side from displayName)
 * output = { ok: true, username: string, alreadyAssigned: boolean }
 *
 * - Auth required; operates on request.auth.uid (the caller's own doc).
 * - Idempotent: if users/{uid}.username exists, returns it (alreadyAssigned: true).
 * - Otherwise derives a slug from displayName, finds a free variant, reserves
 *   usernames/{final} and writes users/{uid}.username = final atomically.
 */
exports.assignUsername = (0, https_1.onCall)({ region: 'northamerica-northeast1', memory: '512MiB' }, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'Auth required');
    }
    const uid = request.auth.uid;
    try {
        const result = await firebase_1.db.runTransaction(async (tx) => {
            var _a;
            const userRef = firebase_1.db.collection('users').doc(uid);
            const userSnap = await tx.get(userRef);
            if (!userSnap.exists) {
                // The users doc must already be created by the client signup flow.
                throw new https_1.HttpsError('failed-precondition', 'User document does not exist');
            }
            const userData = (_a = userSnap.data()) !== null && _a !== void 0 ? _a : {};
            const existing = userData.username;
            // ── Immutability / idempotence: never regenerate an assigned username. ──
            if (typeof existing === 'string' && existing.length > 0) {
                return { username: existing, alreadyAssigned: true };
            }
            const base = slugifyUsername(userData.displayName, uid);
            // Find the first free variant. All reads happen before any write so the
            // transaction stays valid; the registry doc reservation makes concurrent
            // assignments for the same slug mutually exclusive (one retries).
            let candidate = base;
            let attempt = 1;
            // The unbounded fallback (uid-derived) is highly unlikely to collide, but
            // we still bound the loop to avoid pathological transaction sizes.
            // eslint-disable-next-line no-constant-condition
            while (true) {
                const regRef = firebase_1.db.collection('usernames').doc(candidate);
                const regSnap = await tx.get(regRef);
                if (!regSnap.exists) {
                    // Reserve registry + persist on the user doc, atomically.
                    tx.set(regRef, { uid, createdAt: firebase_1.FieldValue.serverTimestamp() });
                    tx.set(userRef, { username: candidate, updatedAt: firebase_1.FieldValue.serverTimestamp() }, { merge: true });
                    return { username: candidate, alreadyAssigned: false };
                }
                attempt += 1;
                if (attempt > MAX_SUFFIX_ATTEMPTS) {
                    // Extremely unlikely. Fall back to a uid-derived handle which is
                    // collision-resistant by construction.
                    const fb = fallbackSlug(uid);
                    const fbRef = firebase_1.db.collection('usernames').doc(fb);
                    const fbSnap = await tx.get(fbRef);
                    if (!fbSnap.exists) {
                        tx.set(fbRef, { uid, createdAt: firebase_1.FieldValue.serverTimestamp() });
                        tx.set(userRef, { username: fb, updatedAt: firebase_1.FieldValue.serverTimestamp() }, { merge: true });
                        return { username: fb, alreadyAssigned: false };
                    }
                    throw new https_1.HttpsError('resource-exhausted', 'Could not allocate a unique username');
                }
                candidate = withSuffix(base, attempt);
            }
        });
        logger.info('assignUsername: username resolved', {
            uid,
            username: result.username,
            alreadyAssigned: result.alreadyAssigned,
        });
        return { ok: true, username: result.username, alreadyAssigned: result.alreadyAssigned };
    }
    catch (error) {
        if (error instanceof https_1.HttpsError) {
            throw error;
        }
        const message = error instanceof Error ? error.message : 'Unknown error';
        logger.error('assignUsername failed', { uid, error: message });
        throw new https_1.HttpsError('internal', 'Failed to assign username: ' + message);
    }
});
//# sourceMappingURL=username.js.map