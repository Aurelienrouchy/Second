# Claude Code Project Instructions

## AI Services Configuration

### Google Gemini SDK (Updated January 2026)

**SDK**: `@google/genai` v1.x (replaces deprecated `@google/generative-ai`)

**Models Used**:
- **Vision/Analysis**: `gemini-2.5-flash` - Latest stable flash model for image analysis
- **Embeddings**: `gemini-embedding-001` - Latest GA embedding model (3072 dimensions)

```typescript
// NEW SDK (GA since May 2025)
import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// For text generation with images
const result = await ai.models.generateContent({
  model: 'gemini-2.5-flash',
  contents: [{ text: prompt }, { inlineData: { mimeType, data: base64 } }],
});

// For embeddings
const embedResult = await ai.models.embedContent({
  model: 'gemini-embedding-001',
  contents: text,
  config: { taskType: 'RETRIEVAL_DOCUMENT' },
});
```

**Location**: `functions/src/index.ts`
**Environment Variable**: `GEMINI_API_KEY` in `functions/.env`

### Package Versions (January 2026)
- `firebase-admin`: ^13.0.0 (supports `FieldValue.vector()`)
- `firebase-functions`: ^6.0.0
- `@google/genai`: ^1.0.0 (new GA SDK)

## Key Technical Decisions

### Firebase Modular API
Always use the modular API for Firebase Functions client:
```typescript
import { httpsCallable } from '@react-native-firebase/functions';
const fn = httpsCallable(functions, 'functionName');
```

### Bottom Sheet Methods
- Use `show()` / `hide()` methods (NOT `present()` / `dismiss()`)
- Components: `CategoryBottomSheet`, `SelectionBottomSheet`, `NeighborhoodBottomSheet`

### TypeScript Timer Types
Use `ReturnType<typeof setTimeout>` instead of `NodeJS.Timeout` for cross-platform compatibility.

## Project Structure

- `/app` - Expo Router screens
- `/components` - Reusable UI components
- `/services` - Business logic and API calls
- `/functions` - Firebase Cloud Functions
- `/docs` - Project documentation
- `/_bmad-output` - BMAD workflow outputs
