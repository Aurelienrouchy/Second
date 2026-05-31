import AsyncStorage from '@react-native-async-storage/async-storage';
import { httpsCallable } from 'firebase/functions';

import { functions } from '@/config/firebaseConfig';
import { ONBOARDING_PREFERENCES_KEY } from '@/constants/storageKeys';
import { guestPreferencesService } from '@/services/guestPreferencesService';
import { generateStyleProfile } from '@/services/styleProfileService';
import { UserService } from '@/services/userService';

const STYLE_PROFILE_MIN_INTERACTIONS = 5;

/**
 * Merge guest data into a freshly authenticated user account.
 *
 * 1. Replay onboarding preferences (size/sex) into the user's Firestore
 *    doc via the saveOnboardingPreferences Cloud Function.
 * 2. Generate a Gemini-backed style profile from guest behavioural data
 *    (likes, views, searches) when there is enough signal AND the user has
 *    explicitly opted in to AI profiling (preferences.aiProfilingConsent ===
 *    true). Opt-in is OFF by default (Loi 25 / RGPD) — without consent we
 *    never send behavioural data to Gemini/Vertex for recommendations. Fire
 *    and forget; failures must not block sign-in.
 *
 * Errors are swallowed because none of these are critical to the sign-in
 * flow. The caller is responsible for clearing the guest session
 * afterward.
 */
export async function mergeGuestDataIntoUser(userId: string): Promise<void> {
  // ── 1. Onboarding preferences ──
  try {
    const onboardingPrefsRaw = await AsyncStorage.getItem(ONBOARDING_PREFERENCES_KEY);
    if (onboardingPrefsRaw) {
      const prefs = JSON.parse(onboardingPrefsRaw);
      const savePrefs = httpsCallable(functions, 'saveOnboardingPreferences');
      await savePrefs({
        sex: prefs.sex,
        sizesTop: prefs.sizesTop || [],
        sizesBottom: prefs.sizesBottom || [],
        sizesShoes: prefs.sizesShoes || [],
        userId,
      });
    }
  } catch (error) {
    if (__DEV__) console.log('[authMerge] onboarding preferences merge failed (silent):', error);
  }

  // ── 2. Behavioural data → style profile ──
  try {
    const guestData = await guestPreferencesService.exportGuestData();
    if (!guestData) return;

    const totalInteractions =
      guestData.likedArticles.length +
      guestData.viewedArticles.length +
      guestData.searches.length;

    if (totalInteractions >= STYLE_PROFILE_MIN_INTERACTIONS) {
      // Non-blocking: don't await
      generateStyleProfile(guestData).catch((error) => {
        if (__DEV__) console.log('[authMerge] style profile generation failed (silent):', error);
      });
    }
  } catch (error) {
    if (__DEV__) console.log('[authMerge] guest data export failed (silent):', error);
  }
}
