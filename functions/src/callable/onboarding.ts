/**
 * Onboarding callable functions
 * Firebase Functions v7 - using onCall
 *
 * Saves user onboarding preferences (sex, sizes, shoe sizes)
 * collected at first app launch, before or after account creation.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db, FieldValue } from '../config/firebase';

/**
 * Valid values for the sex field
 */
const VALID_SEX_VALUES = ['femme', 'homme', 'les-deux', 'enfant'] as const;
type SexValue = typeof VALID_SEX_VALUES[number];

interface OnboardingData {
  sex: SexValue;
  sizesTop: string[];
  sizesBottom: string[];
  sizesShoes: string[];
  userId?: string | null;
}

/**
 * Save onboarding preferences
 *
 * Can be called by:
 * - Authenticated users: saves to their user doc
 * - Guests: saves to a guest_preferences collection (keyed by guestId or device)
 *
 * The data feeds into the personalized "Pour Toi" feed via usePersonalizedFeed.
 */
export const saveOnboardingPreferences = onCall(
  { invoker: 'public', memory: '512MiB' },
  async (request) => {
    const { sex, sizesTop, sizesBottom, sizesShoes, userId } = request.data as OnboardingData;

    // ── Validation ──
    if (!sex || !VALID_SEX_VALUES.includes(sex)) {
      throw new HttpsError(
        'invalid-argument',
        `Invalid sex value. Must be one of: ${VALID_SEX_VALUES.join(', ')}`
      );
    }

    if (!Array.isArray(sizesTop) || !Array.isArray(sizesBottom) || !Array.isArray(sizesShoes)) {
      throw new HttpsError(
        'invalid-argument',
        'sizesTop, sizesBottom, and sizesShoes must be arrays'
      );
    }

    // Sanitize: remove empty strings, limit array sizes
    const sanitize = (arr: string[]): string[] =>
      arr.filter(s => typeof s === 'string' && s.trim().length > 0).slice(0, 20);

    const cleanData = {
      sex,
      sizesTop: sanitize(sizesTop),
      sizesBottom: sanitize(sizesBottom),
      sizesShoes: sanitize(sizesShoes),
      updatedAt: FieldValue.serverTimestamp(),
    };

    try {
      // Determine target: authenticated user or guest
      const authUid = request.auth?.uid;
      const targetUserId = authUid || userId;

      if (targetUserId) {
        // ── Authenticated user or known userId ──
        // Save as part of user preferences for the personalized feed
        const allSizes = [...cleanData.sizesTop, ...cleanData.sizesBottom];

        await db.collection('users').doc(targetUserId).set(
          {
            onboardingPreferences: cleanData,
            preferences: {
              sizes: allSizes,
              shoesSizes: cleanData.sizesShoes,
              sex: cleanData.sex,
            },
            onboardingCompleted: true,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        return { success: true, saved: 'user', userId: targetUserId };
      } else {
        // ── Guest (no auth, no userId) ──
        // Save to guest_preferences collection with auto-generated ID
        const docRef = await db.collection('guest_preferences').add({
          ...cleanData,
          createdAt: FieldValue.serverTimestamp(),
        });

        return { success: true, saved: 'guest', guestPrefId: docRef.id };
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('Error saving onboarding preferences:', error);
      throw new HttpsError('internal', 'Failed to save onboarding preferences: ' + message);
    }
  }
);
