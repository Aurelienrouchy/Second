# Story 6.2: Guest State Management

Status: completed

## Story

As a guest user,
I want my browsing session to be tracked locally,
So that my preferences can be preserved when I create an account.

## Acceptance Criteria

1. **AC1: Guest Session Creation**
   - Given I open the app without an account
   - When the app initializes
   - Then a guest session is created with a unique guestId
   - And the session is stored in AsyncStorage

2. **AC2: View Tracking**
   - Given I am a guest
   - When I view an article for more than 3 seconds
   - Then the article metadata is saved to my guest session

3. **AC3: Search Tracking**
   - Given I am a guest
   - When I perform a search
   - Then my search query is saved to my guest session

4. **AC4: Session Persistence**
   - Given I close and reopen the app
   - When I am still a guest
   - Then my previous guest session is restored

## Tasks / Subtasks

- [x] Task 1: Create guestPreferencesService (AC: 1, 2, 3, 4)
  - [x] 1.1 Create services/guestPreferencesService.ts
  - [x] 1.2 Define GUEST_KEYS constants
  - [x] 1.3 Implement GuestSession interface with timestamps
  - [x] 1.4 Implement createGuestSession method
  - [x] 1.5 Implement getGuestSession method
  - [x] 1.6 Implement updateGuestSession method
  - [x] 1.7 Implement trackView method
  - [x] 1.8 Implement trackSearch method
  - [x] 1.9 Implement trackLike method
  - [x] 1.10 Implement clearGuestSession method

- [x] Task 2: Extend AuthContext (AC: 1, 4)
  - [x] 2.1 Add isGuest boolean state
  - [x] 2.2 Add guestSession state
  - [x] 2.3 Add initGuestSession method
  - [x] 2.4 Add mergeGuestToUser method placeholder
  - [x] 2.5 Initialize guest session on app load if no user

- [x] Task 3: Create useGuestTracking hook (AC: 2, 3)
  - [x] 3.1 Create hooks/useGuestTracking.ts
  - [x] 3.2 Implement trackView with 3-second delay
  - [x] 3.3 Implement trackSearch
  - [x] 3.4 Implement trackLike

## Dev Notes

### Architecture Reference
- Full architecture: `_bmad-output/planning-artifacts/architecture-auth-onboarding.md`
- Pattern references: Section 6 - Implementation Patterns & Consistency Rules

### Key Patterns

**GUEST_KEYS Constants:**
```typescript
const GUEST_KEYS = {
  SESSION: '@guest_session',
  LIKED: '@guest_liked_articles',
  SEARCHES: '@guest_searches',
  VIEWED: '@guest_viewed_articles',
} as const;
```

**GuestSession Interface:**
```typescript
interface GuestSession {
  guestId: string;
  createdAt: string;      // ISO string
  updatedAt: string;      // ISO string
  likedArticles: ArticleMeta[];
  searches: string[];
  viewedArticles: string[];
}

interface ArticleMeta {
  id: string;
  brand: string;
  size: string;
  price: number;
  category: string;
  timestamp: string;  // ISO string
}
```

### Files to Create
| File | Purpose |
|------|---------|
| `services/guestPreferencesService.ts` | AsyncStorage guest session management |
| `hooks/useGuestTracking.ts` | Behavior tracking hook |

### Files to Modify
| File | Changes |
|------|---------|
| `contexts/AuthContext.tsx` | Add isGuest, guestSession, initGuestSession, mergeGuestToUser |

### Project Context Reference
- See CLAUDE.md for Firebase modular API patterns
- Use AsyncStorage for local persistence

## Dev Agent Record

### Agent Model Used
Claude Opus 4.5

### Debug Log References
No errors encountered during implementation.

### Completion Notes List
1. **Task 1 (guestPreferencesService)**: Created comprehensive service with GUEST_KEYS constants, GuestSession interface, and all CRUD + tracking methods. Uses expo-crypto for UUID generation.
2. **Task 2 (AuthContext)**: Extended with isGuest (computed), guestSession state, initGuestSession and mergeGuestToUser methods. Guest session auto-initializes on app load when no user is logged in.
3. **Task 3 (useGuestTracking hook)**: Created hook with trackView (3-second delay using timers), trackSearch, trackLike, and removeLike methods. Only tracks when isGuest is true.

### Additional Features Implemented
- `calculateLocalPreferences()` method for computing preferences from behavior (for future Story 6.4)
- `exportGuestData()` method for merging guest data to user account
- `removeLike()` for handling unlikes
- View tracking limits to last 100 articles, search tracking limits to last 50 queries

### File List

**Created:**
- `services/guestPreferencesService.ts` - Guest session management with AsyncStorage
- `hooks/useGuestTracking.ts` - Behavior tracking hook with 3-second view delay

**Modified:**
- `contexts/AuthContext.tsx` - Added isGuest, guestSession, initGuestSession, mergeGuestToUser
