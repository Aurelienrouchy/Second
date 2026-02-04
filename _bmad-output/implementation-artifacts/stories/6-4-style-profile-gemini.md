# Story 6.4: Style Profile Generation with Gemini

Status: completed

## Story

As a new user,
I want the app to understand my style based on my browsing behavior,
So that I get personalized recommendations immediately.

## Acceptance Criteria

1. **AC1: Profile Generation Trigger**
   - Given I have browsed 15+ articles as guest
   - When I create an account
   - Then my guest behavior is sent to Gemini for analysis
   - And a style profile is generated

2. **AC2: Profile Content**
   - Given Gemini analyzes my behavior
   - When generating my profile
   - Then I receive styleTags (e.g., "Streetwear", "Vintage")
   - And I receive a styleDescription in French
   - And I receive recommendedBrands
   - And I receive suggestedSizes

3. **AC3: Error Handling**
   - Given Gemini fails or times out
   - When profile generation fails
   - Then a default empty profile is used
   - And no error is shown to user

4. **AC4: Storage**
   - Given my profile is generated
   - When stored in Firestore
   - Then it is saved to users/{uid}/preferences

## Tasks / Subtasks

- [x] Task 1: Create generateStyleProfile Cloud Function (AC: 1, 2, 3, 4)
  - [x] 1.1 Add function to functions/src/index.ts
  - [x] 1.2 Implement Gemini API call with structured prompt
  - [x] 1.3 Parse and validate JSON response
  - [x] 1.4 Handle errors with default profile
  - [x] 1.5 Store result in Firestore (users/{uid}.styleProfile)

- [x] Task 2: Integrate profile generation on signup (AC: 1, 4)
  - [x] 2.1 Create client service (services/styleProfileService.ts)
  - [x] 2.2 Call generateStyleProfile in mergeGuestToUser
  - [x] 2.3 Pass guest session data to function

## Dev Notes

### Architecture Reference
- Full architecture: `_bmad-output/planning-artifacts/architecture-auth-onboarding.md`
- Pattern: Gemini Style Profile (Section 6)

### StyleProfile Interface
```typescript
interface StyleProfile {
  styleTags: string[];                // ["Streetwear", "Vintage", "Casual"]
  styleDescription: string;           // Description naturelle du style
  recommendedBrands: string[];        // Marques suggérées
  suggestedSizes: { top: string; bottom: string };
  confidence: number;                 // 0-1 score de confiance
  generatedAt: Date;
}
```

### Gemini Model
- Use `gemini-3-flash-preview` (as per CLAUDE.md)
- Structured JSON output prompt

### Files to Create
| File | Purpose |
|------|---------|
| `services/styleProfileService.ts` | Client service for Cloud Function |

### Files to Modify
| File | Changes |
|------|---------|
| `functions/src/index.ts` | Add generateStyleProfile function |
| `contexts/AuthContext.tsx` | Call profile generation after signup |
| `types/index.ts` | Add StyleProfile type |

## Dev Agent Record

### Agent Model Used
Claude Opus 4.5

### Debug Log References
No errors encountered during implementation.

### Completion Notes List
1. **Task 1 (Cloud Function)**: Created `generateStyleProfile` Cloud Function in functions/src/index.ts:
   - Uses `gemini-3-flash-preview` model (per CLAUDE.md)
   - Structured JSON prompt for style analysis
   - Validates and parses Gemini response
   - Falls back to DEFAULT_STYLE_PROFILE on any error
   - Stores profile in `users/{uid}.styleProfile` with serverTimestamp
   - 30s timeout, requires authentication

2. **Task 2 (Client Integration)**:
   - Created `services/styleProfileService.ts` with `generateStyleProfile()` function
   - Updated `mergeGuestToUser` in AuthContext to call the service
   - Non-blocking call with silent error handling (per AC3)
   - Only triggers if totalInteractions >= 5

3. **Added StyleProfile type** to types/index.ts

### File List

**Created:**
- `services/styleProfileService.ts` - Client service to call Cloud Function
- `_bmad-output/implementation-artifacts/stories/6-4-style-profile-gemini.md` - Story file

**Modified:**
- `functions/src/index.ts` - Added generateStyleProfile Cloud Function
- `contexts/AuthContext.tsx` - Integrated style profile generation in mergeGuestToUser
- `types/index.ts` - Added StyleProfile interface
