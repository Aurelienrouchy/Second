/**
 * Style profile callable functions
 * Firebase Functions v7 - using onCall
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { db, FieldValue } from '../config/firebase';
import { getGenAI, GEMINI_FLASH_MODEL } from '../services/ai';
import { assertPrivateAccountSession, withPrivateAccountSession } from '../utils/privateAccountSession';

/**
 * StyleProfile interface for Gemini response
 */
interface StyleProfile {
  styleTags: string[];
  styleDescription: string;
  recommendedBrands: string[];
  suggestedSizes: { top: string; bottom: string };
  confidence: number;
}

/**
 * Default profile when Gemini fails or insufficient data
 */
const DEFAULT_STYLE_PROFILE: StyleProfile = {
  styleTags: [],
  styleDescription: '',
  recommendedBrands: [],
  suggestedSizes: { top: '', bottom: '' },
  confidence: 0,
};

/**
 * Structured prompt for style profile generation
 */
const STYLE_PROFILE_PROMPT = `Tu es un expert en mode et style vestimentaire.
Analyse les articles likés et les recherches de l'utilisateur ci-dessous.
Génère un profil style en JSON valide UNIQUEMENT (pas de texte avant ou après):
{
  "styleTags": ["tag1", "tag2", "tag3"],
  "styleDescription": "Description courte du style en français (1-2 phrases)",
  "recommendedBrands": ["marque1", "marque2", "marque3"],
  "suggestedSizes": { "top": "M", "bottom": "38" },
  "confidence": 0.8
}

STYLE TAGS possibles: casual, chic, bohème, streetwear, vintage, minimaliste, sportif, rock, preppy, romantique, classique, avant-garde
CONFIDENCE: entre 0 et 1, basé sur la quantité et cohérence des données`;

/**
 * Generate AI style profile based on user interactions
 */
export const generateStyleProfile = onCall(
  {
    region: 'northamerica-northeast1',
    timeoutSeconds: 30,
    memory: '512MiB',
    secrets: ['GEMINI_API_KEY'],
  },
  async (request) => withPrivateAccountSession(request, async () => {
    // Verify authentication
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const userId = request.auth.uid;
    const userRef = db.collection('users').doc(userId);

    // Loi 25 — Gate de consentement au profilage par IA (vérification serveur).
    // Le seul garde client n'est pas suffisant : on relit le consentement
    // explicite dans Firestore avant tout traitement ou écriture de styleProfile.
    const qualifyProfiling = async (tx: FirebaseFirestore.Transaction) => {
      await assertPrivateAccountSession(request, tx);
      const current = await tx.get(userRef);
      if (current.data()?.preferences?.aiProfilingConsent !== true) {
        throw new HttpsError('failed-precondition',
          'Le profilage par IA requiert votre consentement (Réglages > Confidentialité).');
      }
    };
    const storeProfile = async (profile: StyleProfile) => db.runTransaction(async tx => {
      await qualifyProfiling(tx);
      // The consent-bearing user must still exist. Never recreate a deleted
      // profile from an AI response or a default generated before withdrawal.
      tx.update(userRef, { styleProfile: { ...profile, generatedAt: FieldValue.serverTimestamp() } });
    });
    await db.runTransaction(qualifyProfiling);

    const { likedArticles = [], viewedArticles = [], searches = [] } = request.data ?? {};

    // Check if we have enough data
    const totalInteractions = likedArticles.length + viewedArticles.length + searches.length;
    if (totalInteractions < 5) {
      logger.info('style_profile_insufficient_data', { userId, totalInteractions });
      // Store default profile and return
      await storeProfile(DEFAULT_STYLE_PROFILE);
      return { success: true, profile: DEFAULT_STYLE_PROFILE };
    }

    // Get Gemini client
    const ai = getGenAI();
    if (!ai) {
      logger.warn('style_profile_ai_unavailable', { userId });
      await storeProfile(DEFAULT_STYLE_PROFILE);
      return { success: true, profile: DEFAULT_STYLE_PROFILE };
    }

    let profile: StyleProfile;
    try {
      // Build context for Gemini
      // article.size is an ArticleSize object { value, system } (or null) —
      // interpolate the `.value`, never the object (would render [object Object]).
      const likedContext = likedArticles
        .map(
          (a: {
            category?: string;
            brand?: string;
            size?: { value?: string; system?: string } | null;
            price?: number;
          }) =>
            `- ${a.category || 'Article'}: ${a.brand || 'Sans marque'}, taille ${a.size?.value || 'NC'}, ${a.price} $`
        )
        .join('\n');

      const viewedContext = viewedArticles
        .slice(0, 20)
        .map(
          (a: {
            category?: string;
            brand?: string;
            size?: { value?: string; system?: string } | null;
          }) =>
            `- ${a.category || 'Article'}: ${a.brand || 'Sans marque'}, taille ${a.size?.value || 'NC'}`
        )
        .join('\n');

      const searchContext = searches.slice(0, 10).join(', ');

      const userDataPrompt = `
ARTICLES LIKÉS (${likedArticles.length}):
${likedContext || 'Aucun'}

ARTICLES VUS (${Math.min(viewedArticles.length, 20)} sur ${viewedArticles.length}):
${viewedContext || 'Aucun'}

RECHERCHES RÉCENTES:
${searchContext || 'Aucune'}
`;

      // Recheck immediately before disclosure. Withdrawal after a request has
      // left cannot recall it; it does prevent every subsequent local write.
      await db.runTransaction(qualifyProfiling);
      const result = await ai.models.generateContent({
        model: GEMINI_FLASH_MODEL,
        contents: STYLE_PROFILE_PROMPT + '\n\n' + userDataPrompt,
      });
      const responseText = result.text || '';

      // Parse JSON response
      try {
        // Clean response (remove potential markdown code blocks)
        const cleanedResponse = responseText
          .replace(/```json\n?/g, '')
          .replace(/```\n?/g, '')
          .trim();
        profile = JSON.parse(cleanedResponse);

        // Validate structure
        if (!profile.styleTags || !Array.isArray(profile.styleTags)) {
          throw new Error('Invalid styleTags');
        }
        if (typeof profile.styleDescription !== 'string') {
          throw new Error('Invalid styleDescription');
        }
        if (!profile.recommendedBrands || !Array.isArray(profile.recommendedBrands)) {
          profile.recommendedBrands = [];
        }
        if (!profile.suggestedSizes || typeof profile.suggestedSizes !== 'object') {
          profile.suggestedSizes = { top: '', bottom: '' };
        }
        if (typeof profile.confidence !== 'number') {
          profile.confidence = 0.5;
        }
      } catch (parseError) {
        logger.warn('style_profile_invalid_ai_response', { userId, error: parseError instanceof Error ? parseError.message : 'unknown' });
        profile = DEFAULT_STYLE_PROFILE;
      }
    } catch (error: unknown) {
      // Session/consent refusals are final. They must never become a default
      // profile or a successful response through this provider fallback.
      if (error instanceof HttpsError) throw error;
      logger.error('style_profile_generation_failed', { userId, error: error instanceof Error ? error.message : 'unknown' });
      profile = DEFAULT_STYLE_PROFILE;
    }
    await storeProfile(profile);
    logger.info('style_profile_generated', { userId });
    return { success: true, profile };
  })
);
