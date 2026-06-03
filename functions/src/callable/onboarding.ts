/**
 * Onboarding callable functions
 * Firebase Functions v7 - using onCall
 *
 * Persists user onboarding preferences (sex, sizes, shoe sizes) collected at
 * first app launch into the canonical flat `preferences` map on the user doc
 * (preferences.sizes / preferences.shoesSizes / preferences.sex). The legacy
 * nested `onboardingPreferences` snapshot is no longer written — it was never
 * read by the app and went stale on every settings edit.
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
}

/**
 * Save onboarding preferences
 *
 * Can be called by:
 * - Authenticated users: saves to their user doc
 * - Guests: no-op server-side. Guest prefs already live in AsyncStorage
 *   (fire-and-forget on the client) and are replayed at sign-in by
 *   mergeGuestDataIntoUser, so persisting a guest_preferences doc here only
 *   created an orphan (never read, purged after 90d by retentionPurge).
 *
 * The data feeds into the personalized "Pour Toi" feed via usePersonalizedFeed.
 */
export const saveOnboardingPreferences = onCall(
  { region: 'northamerica-northeast1', invoker: 'public', memory: '512MiB' },
  async (request) => {
    const { sex, sizesTop, sizesBottom, sizesShoes } = request.data as OnboardingData;

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

    // cleanData only feeds derivation of the flat `preferences.*` fields below.
    const cleanData: OnboardingData = {
      sex,
      sizesTop: sanitize(sizesTop),
      sizesBottom: sanitize(sizesBottom),
      sizesShoes: sanitize(sizesShoes),
    };

    try {
      if (request.auth?.uid) {
        const allSizes = [...cleanData.sizesTop, ...cleanData.sizesBottom];

        await db.collection('users').doc(request.auth.uid).set(
          {
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

        return { success: true, saved: 'user', userId: request.auth.uid };
      } else {
        // Guest: no server-side persistence. AsyncStorage holds the prefs and
        // mergeGuestDataIntoUser replays them at sign-in — no orphan doc.
        return { success: true, saved: 'guest' };
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('Error saving onboarding preferences:', error);
      throw new HttpsError('internal', 'Failed to save onboarding preferences: ' + message);
    }
  }
);
