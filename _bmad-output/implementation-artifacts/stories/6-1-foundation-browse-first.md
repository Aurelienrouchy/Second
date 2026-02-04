# Story 6.1: Foundation - Remove Facebook & Simplify Routing

Status: completed

## Story

As a user,
I want to access the app feed immediately without barriers,
So that I can browse articles before deciding to create an account.

## Acceptance Criteria

1. **AC1: Direct Feed Access**
   - Given the app launches
   - When loading completes
   - Then I am navigated directly to the feed (tabs)
   - And I do NOT see an onboarding flow
   - And I do NOT see a login requirement

2. **AC2: Guest Browsing**
   - Given I am a guest user
   - When I browse the feed
   - Then I can see all articles
   - And I can search and filter
   - And I can view article details

3. **AC3: Auth Options Without Facebook**
   - Given the auth screen is shown
   - When I view login options
   - Then I see Email, Google, and Apple options
   - And I do NOT see a Facebook option

4. **AC4: Returning User Experience**
   - Given I was previously logged in
   - When I return to the app
   - Then I am still logged in
   - And I do NOT see onboarding again

## Tasks / Subtasks

- [x] Task 1: Remove Facebook Auth (AC: 3)
  - [x] 1.1 Remove signInWithFacebook method from services/authService.ts
  - [x] 1.2 Remove Facebook button and handler from app/auth.tsx
  - [x] 1.3 Remove Facebook config from app.config.js
  - [x] 1.4 Remove react-native-fbsdk-next from package.json
  - [x] 1.5 Run yarn install to update lock file

- [x] Task 2: Update Firestore Rules (AC: 2)
  - [x] 2.1 Add `allow read: if true` on articles collection in firestore.rules (ALREADY DONE)
  - [x] 2.2 Keep authenticated write rules intact (ALREADY DONE)
  - [x] 2.3 Test rules locally with Firebase emulator (SKIPPED - rules already correct)

- [x] Task 3: Simplify Routing (AC: 1, 4)
  - [x] 3.1 Update app/index.tsx to always router.replace('/(tabs)')
  - [x] 3.2 Remove isFirstLaunch check from routing logic
  - [x] 3.3 has_launched_before kept for returning user session management

- [x] Task 4: Cleanup Onboarding Files (AC: 1)
  - [x] 4.1 Delete app/onboarding.tsx
  - [x] 4.2 Delete components/onboarding/OnboardingFlow.tsx
  - [x] 4.3 Delete all files in components/onboarding/
  - [x] 4.4 No onboarding imports in _layout.tsx to remove

## Dev Notes

### Architecture Reference
- Full architecture: `_bmad-output/planning-artifacts/architecture-auth-onboarding.md`
- Brainstorming session: `_bmad-output/analysis/brainstorming-session-2026-01-12.md`

### Key Decisions
1. **Browse First Paradigm**: Users see feed immediately, no gates
2. **Facebook Removal**: Complete removal, no existing FB users
3. **Public Articles**: Firestore rules allow public read on articles
4. **Simplified Routing**: Always go to tabs, no onboarding check

### Files to Modify
| File | Action | Notes |
|------|--------|-------|
| `services/authService.ts` | MODIFY | Remove signInWithFacebook method |
| `app/auth.tsx` | MODIFY | Remove Facebook button |
| `app.json` | MODIFY | Remove Facebook config |
| `package.json` | MODIFY | Remove react-native-fbsdk-next |
| `firestore.rules` | MODIFY | Add public read on articles |
| `app/index.tsx` | MODIFY | Simplify to always route to tabs |
| `app/onboarding.tsx` | DELETE | No longer needed |
| `components/onboarding/*` | DELETE | No longer needed |

### Firestore Rules Change
```javascript
// BEFORE (blocking guests)
match /articles/{articleId} {
  allow read: if request.auth != null;
}

// AFTER (public read)
match /articles/{articleId} {
  allow read: if true;
  allow create: if request.auth != null;
  allow update, delete: if request.auth != null
    && request.auth.uid == resource.data.sellerId;
}
```

### Routing Change
```typescript
// BEFORE (app/index.tsx)
if (isFirstLaunch) {
  router.replace('/auth');
} else {
  router.replace('/(tabs)');
}

// AFTER (app/index.tsx)
if (!isLoading) {
  router.replace('/(tabs)');
}
```

### Testing Notes
- Test app launch as new user → should see feed directly
- Test app launch as returning user → should see feed with session
- Test auth screen → should show Email, Google, Apple only
- Test article browsing without account → should work
- Test search/filter without account → should work

### Project Context Reference
- See CLAUDE.md for Firebase modular API patterns
- Use `gemini-3-flash-preview` for any AI features (future stories)

## Dev Agent Record

### Agent Model Used
Claude Opus 4.5

### Debug Log References
No errors encountered during implementation.

### Completion Notes List
1. **Task 1 (Facebook Removal)**: Complete removal of Facebook auth - removed imports, method, button, config, and dependency
2. **Task 2 (Firestore Rules)**: Already had `allow read: if true` on articles collection - no changes needed
3. **Task 3 (Routing)**: Simplified app/index.tsx to always route to tabs, removed isFirstLaunch check
4. **Task 4 (Onboarding Cleanup)**: Deleted all onboarding files (1 screen + 9 components)

### Additional Changes
- Updated `contexts/AuthContext.tsx` to remove signInWithFacebook from interface and implementation
- Updated `app/auth.tsx` to remove onboarding redirects (now goes to tabs after signup)
- Updated debug info in auth screen to show Apple instead of Facebook status

### File List

**Modified:**
- `services/authService.ts` - Removed Facebook imports, signInWithFacebook method, FB logout, updated getAuthConfigStatus
- `contexts/AuthContext.tsx` - Removed signInWithFacebook from interface and provider
- `app/auth.tsx` - Removed FB button, handler, imports; updated redirects to go to tabs
- `app/index.tsx` - Simplified to always route to tabs (Browse First)
- `app.config.js` - Removed Facebook config (dotenv, FB_APP_ID, URL schemes, info.plist entries)
- `package.json` - Removed react-native-fbsdk-next dependency
- `yarn.lock` - Updated via yarn install

**Deleted:**
- `app/onboarding.tsx`
- `components/onboarding/AccountTypeSelector.tsx`
- `components/onboarding/BrandSelector.tsx`
- `components/onboarding/LocationInput.tsx`
- `components/onboarding/OnboardingFlow.tsx`
- `components/onboarding/OpeningHoursSelector.tsx`
- `components/onboarding/ShopBasicInfo.tsx`
- `components/onboarding/ShopContactForm.tsx`
- `components/onboarding/ShopPhotosUpload.tsx`
- `components/onboarding/SizeSelector.tsx`
