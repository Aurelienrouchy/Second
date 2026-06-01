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
exports.setMarketingConsent = exports.recordSignupConsent = exports.MIN_AGE_SELL = exports.MIN_AGE_REGISTER = exports.POLICY_VERSION = void 0;
/**
 * Consent & age-gate callable functions
 * Firebase Functions v7 - using onCall
 *
 * recordSignupConsent: persists the signup-time legal consents (CGU + politique
 * de confidentialité, et marketing si opt-in) plus la date de naissance de
 * l'utilisateur. L'âge est validé côté serveur (>= 16 pour s'inscrire/acheter).
 *
 * SECURITY: les documents de consentement (users/{uid}/consents/{autoId}) sont
 * écrits exclusivement par cette fonction via l'Admin SDK. Les règles Firestore
 * interdisent toute écriture client (allow write: if false).
 */
const https_1 = require("firebase-functions/v2/https");
const logger = __importStar(require("firebase-functions/logger"));
const firebase_1 = require("../config/firebase");
/**
 * Shared naming contract (backend <-> app). Do not drift without updating both.
 */
exports.POLICY_VERSION = '2026-05-31';
exports.MIN_AGE_REGISTER = 16; // s'inscrire / acheter
exports.MIN_AGE_SELL = 18; // vendre (onboarding Stripe Connect)
/**
 * Validate the "YYYY-MM-DD" shape and that it is a real calendar date.
 * Returns the parsed {year, month, day} (month 1-12) or null if invalid.
 */
function parseIsoDate(value) {
    if (typeof value !== 'string')
        return null;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match)
        return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    // Round-trip through Date (UTC) to reject impossible dates like 2026-02-30.
    const d = new Date(Date.UTC(year, month - 1, day));
    if (d.getUTCFullYear() !== year ||
        d.getUTCMonth() !== month - 1 ||
        d.getUTCDate() !== day) {
        return null;
    }
    return { year, month, day };
}
/**
 * Compute the age in whole years as of today, accounting for whether the
 * birthday has already occurred this year.
 *
 * Le jour calendaire courant est résolu dans le fuseau America/Toronto (marché
 * cible) plutôt qu'en UTC, afin d'aligner le calcul serveur sur l'heure locale
 * des utilisateurs canadiens (le client calcule en heure locale).
 */
function computeAge(dob) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Toronto',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(new Date());
    const partValue = (type) => { var _a; return Number((_a = parts.find((p) => p.type === type)) === null || _a === void 0 ? void 0 : _a.value); };
    const todayYear = partValue('year');
    const todayMonth = partValue('month'); // 1-12
    const todayDay = partValue('day');
    let age = todayYear - dob.year;
    // Birthday not reached yet this year => subtract one.
    if (todayMonth < dob.month || (todayMonth === dob.month && todayDay < dob.day)) {
        age -= 1;
    }
    return age;
}
/**
 * recordSignupConsent
 *
 * input  = { dateOfBirth: "YYYY-MM-DD", acceptedTerms, acceptedPrivacy, marketingOptIn }
 * output = { ok: true, age: number }
 *
 * - Auth requise.
 * - Âge >= MIN_AGE_REGISTER (16) sinon invalid-argument.
 * - acceptedTerms et acceptedPrivacy doivent être true (consentement obligatoire).
 * - Écrit users/{uid}.dateOfBirth (string ISO).
 * - Crée les docs consents : terms + privacy_policy toujours ; marketing
 *   seulement si marketingOptIn === true. version = POLICY_VERSION.
 */
exports.recordSignupConsent = (0, https_1.onCall)({ region: 'northamerica-northeast1', memory: '512MiB' }, async (request) => {
    var _a;
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'Auth required');
    }
    const uid = request.auth.uid;
    const data = ((_a = request.data) !== null && _a !== void 0 ? _a : {});
    const { dateOfBirth, acceptedTerms, acceptedPrivacy, marketingOptIn } = data;
    // ── Validation ──
    if (typeof dateOfBirth !== 'string') {
        throw new https_1.HttpsError('invalid-argument', 'dateOfBirth is required (format YYYY-MM-DD)');
    }
    const dob = parseIsoDate(dateOfBirth);
    if (!dob) {
        throw new https_1.HttpsError('invalid-argument', 'dateOfBirth must be a valid ISO date (YYYY-MM-DD)');
    }
    if (typeof acceptedTerms !== 'boolean' || typeof acceptedPrivacy !== 'boolean') {
        throw new https_1.HttpsError('invalid-argument', 'acceptedTerms and acceptedPrivacy must be booleans');
    }
    if (!acceptedTerms || !acceptedPrivacy) {
        throw new https_1.HttpsError('failed-precondition', 'Les conditions générales et la politique de confidentialité doivent être acceptées');
    }
    const wantsMarketing = marketingOptIn === true;
    const age = computeAge(dob);
    if (age < exports.MIN_AGE_REGISTER) {
        throw new https_1.HttpsError('invalid-argument', `Vous devez avoir au moins ${exports.MIN_AGE_REGISTER} ans pour utiliser Second`);
    }
    try {
        const batch = firebase_1.db.batch();
        const userRef = firebase_1.db.collection('users').doc(uid);
        const consentsRef = userRef.collection('consents');
        // Persist the date of birth (ISO string — never undefined).
        batch.set(userRef, {
            dateOfBirth,
            updatedAt: firebase_1.FieldValue.serverTimestamp(),
        }, { merge: true });
        const consentTypes = ['terms', 'privacy_policy'];
        if (wantsMarketing) {
            consentTypes.push('marketing');
        }
        for (const type of consentTypes) {
            batch.set(consentsRef.doc(), {
                type,
                version: exports.POLICY_VERSION,
                acceptedAt: firebase_1.FieldValue.serverTimestamp(),
                channel: 'app',
            });
        }
        await batch.commit();
        logger.info('recordSignupConsent: consents recorded', {
            uid,
            age,
            policyVersion: exports.POLICY_VERSION,
            marketing: wantsMarketing,
        });
        return { ok: true, age };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        logger.error('recordSignupConsent failed', { uid, error: message });
        throw new https_1.HttpsError('internal', 'Failed to record consent: ' + message);
    }
});
/**
 * setMarketingConsent
 *
 * input  = { enabled: boolean }
 * output = { ok: true, enabled: boolean }
 *
 * Loi 25 (art. 14) / LCAP : le retrait du consentement marketing doit être
 * (a) journalisé de manière append-only comme preuve, et (b) appliqué côté
 * serveur de sorte qu'aucun envoi marketing ne parte après le retrait.
 *
 * - Auth requise.
 * - Journalise APPEND-ONLY un nouveau doc dans users/{uid}/consents :
 *   { type: 'marketing', granted, version, acceptedAt, channel }. Les docs
 *   existants ne sont JAMAIS modifiés (preuve immuable).
 * - Applique l'effet via Admin SDK :
 *     users/{uid}.preferences.marketingConsent = enabled
 *     users/{uid}.preferences.notifications.priceDrops / articleFavorited /
 *       swapZoneReminder = enabled
 *   Ces préférences sont relues par les triggers existants
 *   (functions/src/triggers/favorites.ts) avant tout envoi : couper ces flags
 *   garantit qu'aucune notification marketing n'est émise après le retrait.
 * - N'écrit jamais undefined (booléens dérivés de `enabled`).
 */
exports.setMarketingConsent = (0, https_1.onCall)({ region: 'northamerica-northeast1', memory: '512MiB' }, async (request) => {
    var _a;
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'Auth required');
    }
    const uid = request.auth.uid;
    const data = ((_a = request.data) !== null && _a !== void 0 ? _a : {});
    const { enabled } = data;
    if (typeof enabled !== 'boolean') {
        throw new https_1.HttpsError('invalid-argument', 'enabled must be a boolean');
    }
    try {
        const batch = firebase_1.db.batch();
        const userRef = firebase_1.db.collection('users').doc(uid);
        const consentsRef = userRef.collection('consents');
        // (a) Append-only proof — new doc, never touch existing ones.
        batch.set(consentsRef.doc(), {
            type: 'marketing',
            granted: enabled,
            version: exports.POLICY_VERSION,
            acceptedAt: firebase_1.FieldValue.serverTimestamp(),
            channel: 'app',
        });
        // (b) Server-side enforcement — mirror onto the preferences read by triggers.
        batch.set(userRef, {
            preferences: {
                marketingConsent: enabled,
                notifications: {
                    priceDrops: enabled,
                    articleFavorited: enabled,
                    swapZoneReminder: enabled,
                },
            },
            updatedAt: firebase_1.FieldValue.serverTimestamp(),
        }, { merge: true });
        await batch.commit();
        logger.info('setMarketingConsent: consent updated', {
            uid,
            granted: enabled,
            policyVersion: exports.POLICY_VERSION,
        });
        return { ok: true, enabled };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        logger.error('setMarketingConsent failed', { uid, error: message });
        throw new https_1.HttpsError('internal', 'Failed to set marketing consent: ' + message);
    }
});
//# sourceMappingURL=consent.js.map