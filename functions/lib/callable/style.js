"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateStyleProfile = void 0;
/**
 * Style profile callable functions
 * Firebase Functions v7 - using onCall
 */
const https_1 = require("firebase-functions/v2/https");
const firebase_1 = require("../config/firebase");
const ai_1 = require("../services/ai");
/**
 * Default profile when Gemini fails or insufficient data
 */
const DEFAULT_STYLE_PROFILE = {
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
exports.generateStyleProfile = (0, https_1.onCall)({
    timeoutSeconds: 30,
    memory: '512MiB',
}, async (request) => {
    // Verify authentication
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'User must be authenticated');
    }
    const userId = request.auth.uid;
    const { likedArticles = [], viewedArticles = [], searches = [] } = request.data;
    // Check if we have enough data
    const totalInteractions = likedArticles.length + viewedArticles.length + searches.length;
    if (totalInteractions < 5) {
        console.log(`Insufficient data for style profile: ${totalInteractions} interactions`);
        // Store default profile and return
        await firebase_1.db.collection('users').doc(userId).set({
            styleProfile: Object.assign(Object.assign({}, DEFAULT_STYLE_PROFILE), { generatedAt: firebase_1.FieldValue.serverTimestamp() }),
        }, { merge: true });
        return { success: true, profile: DEFAULT_STYLE_PROFILE };
    }
    // Get Gemini client
    const ai = (0, ai_1.getGenAI)();
    if (!ai) {
        console.error('Gemini API not configured, using default profile');
        await firebase_1.db.collection('users').doc(userId).set({
            styleProfile: Object.assign(Object.assign({}, DEFAULT_STYLE_PROFILE), { generatedAt: firebase_1.FieldValue.serverTimestamp() }),
        }, { merge: true });
        return { success: true, profile: DEFAULT_STYLE_PROFILE };
    }
    try {
        // Build context for Gemini
        const likedContext = likedArticles
            .map((a) => `- ${a.category || 'Article'}: ${a.brand || 'Sans marque'}, taille ${a.size || 'NC'}, ${a.price}€`)
            .join('\n');
        const viewedContext = viewedArticles
            .slice(0, 20)
            .map((a) => `- ${a.category || 'Article'}: ${a.brand || 'Sans marque'}, taille ${a.size || 'NC'}`)
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
        const result = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: STYLE_PROFILE_PROMPT + '\n\n' + userDataPrompt,
        });
        const responseText = result.text || '';
        // Parse JSON response
        let profile;
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
        }
        catch (parseError) {
            console.error('Failed to parse Gemini response:', parseError, responseText);
            profile = DEFAULT_STYLE_PROFILE;
        }
        // Store profile in Firestore
        await firebase_1.db.collection('users').doc(userId).set({
            styleProfile: Object.assign(Object.assign({}, profile), { generatedAt: firebase_1.FieldValue.serverTimestamp() }),
        }, { merge: true });
        console.log(`Generated style profile for user ${userId}:`, profile.styleTags);
        return { success: true, profile };
    }
    catch (error) {
        console.error('Error generating style profile:', error);
        // Store default profile on error
        await firebase_1.db.collection('users').doc(userId).set({
            styleProfile: Object.assign(Object.assign({}, DEFAULT_STYLE_PROFILE), { generatedAt: firebase_1.FieldValue.serverTimestamp() }),
        }, { merge: true });
        return { success: true, profile: DEFAULT_STYLE_PROFILE };
    }
});
//# sourceMappingURL=style.js.map