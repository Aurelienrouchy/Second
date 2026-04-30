"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.saveOnboardingPreferences = void 0;
/**
 * Onboarding callable functions
 * Firebase Functions v7 - using onCall
 *
 * Saves user onboarding preferences (sex, sizes, shoe sizes)
 * collected at first app launch, before or after account creation.
 */
const https_1 = require("firebase-functions/v2/https");
const firebase_1 = require("../config/firebase");
/**
 * Valid values for the sex field
 */
const VALID_SEX_VALUES = ['femme', 'homme', 'les-deux', 'enfant'];
/**
 * Save onboarding preferences
 *
 * Can be called by:
 * - Authenticated users: saves to their user doc
 * - Guests: saves to a guest_preferences collection (keyed by guestId or device)
 *
 * The data feeds into the personalized "Pour Toi" feed via usePersonalizedFeed.
 */
exports.saveOnboardingPreferences = (0, https_1.onCall)({ invoker: 'public', memory: '512MiB' }, async (request) => {
    var _a;
    const { sex, sizesTop, sizesBottom, sizesShoes, userId } = request.data;
    // ── Validation ──
    if (!sex || !VALID_SEX_VALUES.includes(sex)) {
        throw new https_1.HttpsError('invalid-argument', `Invalid sex value. Must be one of: ${VALID_SEX_VALUES.join(', ')}`);
    }
    if (!Array.isArray(sizesTop) || !Array.isArray(sizesBottom) || !Array.isArray(sizesShoes)) {
        throw new https_1.HttpsError('invalid-argument', 'sizesTop, sizesBottom, and sizesShoes must be arrays');
    }
    // Sanitize: remove empty strings, limit array sizes
    const sanitize = (arr) => arr.filter(s => typeof s === 'string' && s.trim().length > 0).slice(0, 20);
    const cleanData = {
        sex,
        sizesTop: sanitize(sizesTop),
        sizesBottom: sanitize(sizesBottom),
        sizesShoes: sanitize(sizesShoes),
        updatedAt: firebase_1.FieldValue.serverTimestamp(),
    };
    try {
        // Determine target: authenticated user or guest
        const authUid = (_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid;
        const targetUserId = authUid || userId;
        if (targetUserId) {
            // ── Authenticated user or known userId ──
            // Save as part of user preferences for the personalized feed
            const allSizes = [...cleanData.sizesTop, ...cleanData.sizesBottom];
            await firebase_1.db.collection('users').doc(targetUserId).set({
                onboardingPreferences: cleanData,
                preferences: {
                    sizes: allSizes,
                    shoesSizes: cleanData.sizesShoes,
                    sex: cleanData.sex,
                },
                onboardingCompleted: true,
                updatedAt: firebase_1.FieldValue.serverTimestamp(),
            }, { merge: true });
            return { success: true, saved: 'user', userId: targetUserId };
        }
        else {
            // ── Guest (no auth, no userId) ──
            // Save to guest_preferences collection with auto-generated ID
            const docRef = await firebase_1.db.collection('guest_preferences').add(Object.assign(Object.assign({}, cleanData), { createdAt: firebase_1.FieldValue.serverTimestamp() }));
            return { success: true, saved: 'guest', guestPrefId: docRef.id };
        }
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('Error saving onboarding preferences:', error);
        throw new https_1.HttpsError('internal', 'Failed to save onboarding preferences: ' + message);
    }
});
//# sourceMappingURL=onboarding.js.map