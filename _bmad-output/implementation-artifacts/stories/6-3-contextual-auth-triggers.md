# Story 6.3: Contextual Auth Triggers

Status: completed

## Story

As a guest user,
I want to see a contextual signup prompt when I try to perform protected actions,
So that I understand why I need an account.

## Acceptance Criteria

1. **AC1: Like Trigger**
   - Given I am a guest and tap the like button
   - When the action is triggered
   - Then I see a modal with message "Crée un compte pour sauvegarder tes coups de coeur"
   - And I see Email, Google, Apple signup options

2. **AC2: Message Trigger**
   - Given I am a guest and try to message a seller
   - When the action is triggered
   - Then I see a modal with message "Inscris-toi pour contacter le vendeur"

3. **AC3: Buy Trigger**
   - Given I am a guest and try to buy
   - When the action is triggered
   - Then I see a modal with message "Crée un compte pour finaliser ton achat"

4. **AC4: Swap Party Trigger**
   - Given I am a guest and try to join a Swap Party
   - When the action is triggered
   - Then I see a modal with message "Inscris-toi pour participer à cette Swap Party"

5. **AC5: Post-auth Action**
   - Given I complete signup from a trigger
   - When authentication succeeds
   - Then the original action is completed automatically
   - And my guest preferences are merged to my account

## Tasks / Subtasks

- [x] Task 1: Create AUTH_MESSAGES constants (AC: 1, 2, 3, 4)
  - [x] 1.1 Create constants/authMessages.ts
  - [x] 1.2 Define all 6 contextual messages + default

- [x] Task 2: Update AuthBottomSheet (AC: 1, 2, 3, 4)
  - [x] 2.1 Remove Facebook button (already removed from auth service)
  - [x] 2.2 Add Apple Sign-In button
  - [x] 2.3 Update to receive and display contextual message
  - [x] 2.4 Update handleSuccess to merge guest data

- [x] Task 3: Update AuthRequiredContext (AC: 1, 2, 3, 4, 5)
  - [x] 3.1 Update showAuthSheet to pass message to component
  - [x] 3.2 Guest data merge integrated via AuthBottomSheet handleSuccess

- [x] Task 4: Update components with triggers (AC: 1, 2, 3, 4, 5)
  - [x] 4.1 Update like button with AUTH_MESSAGES.like (article detail + ArticleGrid)
  - [x] 4.2 Update message button with AUTH_MESSAGES.message
  - [x] 4.3 Update buy/offer button with AUTH_MESSAGES.buy
  - [x] 4.4 Update swap party join with AUTH_MESSAGES.swapParty

## Dev Notes

### Architecture Reference
- Full architecture: `_bmad-output/planning-artifacts/architecture-auth-onboarding.md`
- Pattern: AUTH_MESSAGES constants

### AUTH_MESSAGES Pattern
```typescript
const AUTH_MESSAGES = {
  like: "Crée un compte pour sauvegarder tes coups de coeur",
  message: "Inscris-toi pour contacter le vendeur",
  buy: "Crée un compte pour finaliser ton achat",
  sell: "Inscris-toi pour vendre tes articles",
  follow: "Crée un compte pour suivre ce vendeur",
  swapParty: "Inscris-toi pour participer à cette Swap Party",
} as const;
```

### Files to Create
| File | Purpose |
|------|---------|
| `constants/authMessages.ts` | Centralized auth trigger messages |

### Files to Modify
| File | Changes |
|------|---------|
| `components/AuthBottomSheet.tsx` | Remove FB, add Apple, display contextual message |
| `contexts/AuthRequiredContext.tsx` | Pass message to component, add merge on success |
| `app/article/[id].tsx` | Add auth triggers for like, message, buy |
| `components/ArticleGrid.tsx` | Add auth trigger for like |

## Dev Agent Record

### Agent Model Used
Claude Opus 4.5

### Debug Log References
No errors encountered during implementation.

### Completion Notes List
1. **Task 1 (AUTH_MESSAGES constants)**: Created constants/authMessages.ts with 7 contextual messages (like, message, buy, sell, follow, swapParty, default).
2. **Task 2 (AuthBottomSheet)**: Updated to support dynamic messages via show() method. Added Apple Sign-In button with black styling. Facebook button already removed. handleSuccess now calls mergeGuestToUser for guest data preservation.
3. **Task 3 (AuthRequiredContext)**: Fixed showAuthSheet to properly pass the message parameter to AuthBottomSheet.show().
4. **Task 4 (Component triggers)**: Updated all components to use AUTH_MESSAGES constants:
   - article/[id].tsx: like, message, buy triggers
   - ArticleGrid.tsx: like trigger
   - swap-party/[id].tsx: swapParty trigger for join and item interactions

### File List

**Created:**
- `constants/authMessages.ts` - Centralized AUTH_MESSAGES constants

**Modified:**
- `components/AuthBottomSheet.tsx` - Dynamic message support, Apple button
- `contexts/AuthRequiredContext.tsx` - Pass message to show() method
- `app/article/[id].tsx` - Use AUTH_MESSAGES for like, message, buy
- `components/ArticleGrid.tsx` - Use AUTH_MESSAGES.like
- `app/swap-party/[id].tsx` - Use AUTH_MESSAGES.swapParty with requireAuth
