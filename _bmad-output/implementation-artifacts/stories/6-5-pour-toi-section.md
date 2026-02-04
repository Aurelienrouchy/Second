# Story 6.5: "Pour Toi" Personalized Section

Status: completed

## Story

As a logged-in user with preferences,
I want to see a personalized "Pour toi" section on the home feed,
So that I discover articles matching my style.

## Acceptance Criteria

1. **AC1: Section Display**
   - Given I have a style profile
   - When I view the home feed
   - Then I see a "Pour toi" section near the top
   - And it displays articles matching my preferences

2. **AC2: Brand Prioritization**
   - Given my profile includes topBrands/recommendedBrands
   - When loading "Pour toi" articles
   - Then articles from those brands are prioritized

3. **AC3: Size Prioritization**
   - Given my profile includes suggestedSizes
   - When loading "Pour toi" articles
   - Then articles in my sizes are prioritized

4. **AC4: No Profile Handling**
   - Given I don't have a style profile yet
   - When I view the home feed
   - Then I do NOT see a "Pour toi" section
   - And I see the regular feed

## Tasks / Subtasks

- [x] Task 1: Update usePersonalizedFeed hook (AC: 1, 2, 3)
  - [x] 1.1 Add support for AI-generated styleProfile
  - [x] 1.2 Priority: styleProfile > manual preferences
  - [x] 1.3 Return styleTags and hasProfile
  - [x] 1.4 Query articles based on recommendedBrands and suggestedSizes

- [x] Task 2: Integrate on home screen (AC: 1, 4)
  - [x] 2.1 Use hasProfile for conditional rendering
  - [x] 2.2 Display style tag badges when available
  - [x] 2.3 Dynamic subtitle based on profile source

## Dev Notes

### Architecture Reference
- Full architecture: `_bmad-output/planning-artifacts/architecture-auth-onboarding.md`

### Query Strategy
- Query by brands from recommendedBrands (OR query)
- Filter by sizes from suggestedSizes
- Limit to 10 articles
- Exclude user's own articles
- Score by: exact brand match (3pts), size match (2pts), style tag match (1pt)

### StyleProfile Fields Used
```typescript
interface StyleProfile {
  styleTags: string[];           // For header badges
  recommendedBrands: string[];   // For brand query
  suggestedSizes: { top: string; bottom: string }; // For size filter
}
```

### Files to Create
| File | Purpose |
|------|---------|
| `components/ForYouSection.tsx` | "Pour toi" personalized section |

### Files to Modify
| File | Changes |
|------|---------|
| `app/(tabs)/index.tsx` | Add ForYouSection |

## Dev Agent Record

### Agent Model Used
Claude Opus 4.5

### Debug Log References
No errors encountered during implementation.

### Completion Notes List
1. **Task 1 (usePersonalizedFeed hook)**: Updated to support AI-generated styleProfile:
   - Added `getPersonalizationData()` function with priority: styleProfile > preferences
   - Returns `styleTags` and `hasProfile` for UI rendering
   - Uses `recommendedBrands` from styleProfile for brand filtering
   - Uses `suggestedSizes` (top/bottom) for size filtering
   - Confidence check: only uses styleProfile if confidence > 0

2. **Task 2 (Home screen)**: Updated "Pour Toi" section:
   - Changed condition to use `hasProfile` instead of manual preference checks
   - Added style tag badges (violet #8B5CF6 background) above section
   - Dynamic subtitle: "Basé sur ton style" (AI) vs "Basé sur tes préférences" (manual)
   - Shows max 3 style tags

3. **Added `styleProfile` to User type** in types/index.ts

### File List

**Modified:**
- `hooks/usePersonalizedFeed.ts` - Added styleProfile support, styleTags, hasProfile
- `app/(tabs)/index.tsx` - Updated Pour Toi section with style tags badges
- `types/index.ts` - Added styleProfile field to User interface
