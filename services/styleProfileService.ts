import functions from '@react-native-firebase/functions';
import { StyleProfile } from '@/types';
import { GuestSession } from './guestPreferencesService';

/**
 * Default profile when generation fails or insufficient data
 */
export const DEFAULT_STYLE_PROFILE: StyleProfile = {
  styleTags: [],
  styleDescription: '',
  recommendedBrands: [],
  suggestedSizes: { top: '', bottom: '' },
  confidence: 0,
  generatedAt: new Date(),
};

/**
 * Generate user style profile from guest behavior using Gemini AI
 * Called after signup when guest data is available
 */
export async function generateStyleProfile(
  guestSession: GuestSession | null
): Promise<StyleProfile> {
  try {
    // If no guest session, return default profile
    if (!guestSession) {
      console.log('No guest session for style profile generation');
      return DEFAULT_STYLE_PROFILE;
    }

    const { likedArticles, viewedArticles, searches } = guestSession;

    // Check minimum data threshold
    const totalInteractions = likedArticles.length + viewedArticles.length + searches.length;
    if (totalInteractions < 5) {
      console.log(`Insufficient data for style profile: ${totalInteractions} interactions`);
      return DEFAULT_STYLE_PROFILE;
    }

    // Call Cloud Function
    const generateStyleProfileFn = functions().httpsCallable('generateStyleProfile');
    const result = await generateStyleProfileFn({
      likedArticles,
      viewedArticles,
      searches,
    });

    const data = result.data as { success: boolean; profile: StyleProfile };

    if (data.success && data.profile) {
      console.log('Style profile generated:', data.profile.styleTags);
      return {
        ...data.profile,
        generatedAt: data.profile.generatedAt || new Date(),
      };
    }

    return DEFAULT_STYLE_PROFILE;
  } catch (error) {
    console.error('Error generating style profile:', error);
    // Return default profile on error (silent failure per AC3)
    return DEFAULT_STYLE_PROFILE;
  }
}
