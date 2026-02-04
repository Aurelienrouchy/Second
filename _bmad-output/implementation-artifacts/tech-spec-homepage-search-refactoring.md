---
title: 'Homepage & Search Refactoring'
slug: 'homepage-search-refactoring'
created: '2026-01-07'
status: 'completed'
stepsCompleted: [1, 2, 3, 4, 5]
tech_stack:
  - React Native / Expo
  - TypeScript
  - Firebase Firestore
  - Firebase Cloud Functions
  - '@gorhom/bottom-sheet'
  - 'react-native-reanimated'
  - 'expo-location'
files_to_modify:
  - app/(tabs)/index.tsx
  - app/(tabs)/_layout.tsx
  - app/(tabs)/search.tsx (delete)
code_patterns:
  - CategoryBottomSheet drill-down navigation
  - useArticleSearch hook for filtering
  - FavoritesContext for user preferences
  - SearchFilters type for filter state
test_patterns: []
---

# Tech-Spec: Homepage & Search Refactoring

**Created:** 2026-01-07

## Overview

### Problem Statement

The current Homepage (`app/(tabs)/index.tsx`) is a basic product grid with just a logo and notification button - no search bar, no personalization, no quick categories. The Search page (`app/(tabs)/search.tsx`) ironically has NO search bar - just static hardcoded categories (4 items) and 28 hardcoded brands. This results in poor UX compared to competitors like Vinted, Depop, and Vestiaire Collective.

### Solution

Transform the Homepage into a rich discovery hub featuring:
1. A search bar that opens a full-screen Vinted-style overlay
2. Quick category chips for rapid navigation
3. Clickable recent searches (synced via Firestore)
4. Personalized "Pour Toi" feed using favorites/views/purchase signals
5. "Pres de toi" geolocation-based section

The Search Overlay will provide:
- Full-screen modal experience (like Vinted)
- Category tree navigation with drill-down
- Brand picker
- Recent searches (Firestore-synced)
- Saved searches with Cloud Function alerts

Remove the redundant "Recherche" tab from the tab bar.

### Scope

**In Scope:**
- Search bar on Homepage that opens full-screen overlay
- Full-screen Search Overlay (modal, not bottom sheet)
- Category tree navigation (reuse/adapt existing CategoryBottomSheet pattern)
- Brands section with popular brands
- Recent searches stored in Firestore user profile
- Saved searches with notification alerts (Cloud Function)
- "Pour Toi" AI-personalized feed (v1: based on favorites, views, sizes)
- "Pres de toi" geolocation section
- Remove "Recherche" tab from tab bar
- All necessary filters: category, brand, size, price, condition, material, location

**Out of Scope:**
- Visual Search / Image similarity (P2 - separate spec)
- "Tendances" section (removed per user feedback)
- Complex ML recommendation engine (v1 uses simple matching rules)
- Advanced analytics dashboard

## Context for Development

### Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Search Overlay Type | Full-screen animated View (not native Modal) | Custom animations with `react-native-reanimated`, avoids Modal limitations |
| Recent Searches Storage | Firestore `users/{uid}/searchHistory/` | Syncs across devices, persists with account |
| Saved Search Alerts | Cloud Function (scheduled every 15min) + FCM | Batch processing efficient, real-time not needed |
| "Pour Toi" Algorithm | Rule-based v1 | Simple matching on categories/brands/sizes extracted from favorites |
| Category Navigation | Extract reusable hook from CategoryBottomSheet | Pattern already proven, avoid duplication |

### Codebase Patterns

#### 1. Category Drill-Down Navigation (CategoryBottomSheet.tsx:24-66)
```typescript
// Navigation state pattern using path array
const [navigationPath, setNavigationPath] = useState<CategoryNode[]>([]);

// Current list computed from path
const currentList = useMemo(() => {
  if (navigationPath.length === 0) return CATEGORIES;
  const lastNode = navigationPath[navigationPath.length - 1];
  return lastNode.children || [];
}, [navigationPath]);

// Navigate down
const handleSelectCategory = (category: CategoryNode) => {
  if (category.children?.length > 0) {
    setNavigationPath([...navigationPath, category]);
  } else {
    // Leaf reached - return full path
    const fullPathIds = [...navigationPath.map(n => n.id), category.id];
    onSelect(fullPathIds);
  }
};
```
**Action:** Extract into `useCategoryNavigation()` hook for reuse in SearchOverlay.

#### 2. Article Search with Filters (useArticleSearch.ts)
```typescript
// Filter state shape
const [filters, setFilters] = useState<SearchFilters>({
  colors: [], sizes: [], materials: [], brands: [],
  patterns: [], condition: undefined,
  minPrice: undefined, maxPrice: undefined, sortBy: 'recent',
});

// Search with category path
const buildSearchFilters = useCallback(() => ({
  categoryIds: selectedCategoryPath.length > 0 ? selectedCategoryPath : undefined,
  // ...other filters
}), [filters, selectedCategoryPath]);
```
**Action:** Reuse directly; add `searchHistory` tracking.

#### 3. Favorites/User Signals (FavoritesContext.tsx + favoritesService.ts)
```typescript
// Favorites stored in Firestore: favorites/{userId}.articleIds[]
// Can extract categories/brands/sizes from favorited articles for "Pour Toi"
static async getUserFavoriteArticles(userId: string): Promise<Article[]>
```
**Action:** Create `useUserSignals()` hook to aggregate preferences from favorites.

#### 4. Geolocation Distance Calculation (useArticleSearch.ts:21-38)
```typescript
// Haversine formula already implemented
const calculateDistance = (lat1, lon1, lat2, lon2): number => { ... }

// useUserLocation hook stub exists, needs expo-location integration
export const useUserLocation = () => {
  // TODO: Implement with expo-location
}
```
**Action:** Complete `useUserLocation()` implementation with expo-location.

### Files to Reference

| File | Purpose |
| ---- | ------- |
| `app/(tabs)/index.tsx` | Current Homepage - will be refactored |
| `app/(tabs)/_layout.tsx` | Tab bar layout - remove search tab (line 36-42) |
| `app/(tabs)/search.tsx` | Current search page - will be deleted |
| `components/CategoryBottomSheet.tsx` | Category drill-down pattern to extract |
| `hooks/useArticleSearch.ts` | Search hook to reuse and extend |
| `contexts/FavoritesContext.tsx` | Favorites for "Pour Toi" signals |
| `services/favoritesService.ts` | Firestore favorites operations |
| `services/articlesService.ts` | Article search with filters |
| `data/categories-v2.ts` | Category tree structure (CATEGORIES, CategoryNode) |
| `data/brands.ts` | Brand utilities (brands in Firestore) |
| `types/index.ts` | SearchFilters, Article, User types |

### Firestore Schema (New Collections)

```
users/{userId}/
  ├── searchHistory/
  │   └── {searchId}
  │       ├── query: string
  │       ├── filters: SearchFilters
  │       ├── timestamp: Timestamp
  │       └── resultCount: number
  │
  ├── savedSearches/
  │   └── {savedSearchId}
  │       ├── name: string
  │       ├── query: string
  │       ├── filters: SearchFilters
  │       ├── createdAt: Timestamp
  │       ├── lastNotifiedAt: Timestamp
  │       └── notifyNewItems: boolean
  │
  └── viewHistory/
      └── {viewId}
          ├── articleId: string
          ├── timestamp: Timestamp
          └── categoryIds: string[]
```

## Implementation Plan

### Tasks

#### Phase 1: Foundation (Infrastructure)

**Task 1.1: Create SearchOverlay Component Structure**
- Create `components/SearchOverlay/index.tsx` (main component)
- Create `components/SearchOverlay/SearchInput.tsx` (search bar with back button)
- Create `components/SearchOverlay/RecentSearches.tsx` (clickable history)
- Create `components/SearchOverlay/SavedSearches.tsx` (with bell icon toggle)
- Create `components/SearchOverlay/CategoryTree.tsx` (adapted from CategoryBottomSheet)
- Create `components/SearchOverlay/BrandGrid.tsx` (popular brands)
- Use `react-native-reanimated` for slide-in animation from bottom

**Task 1.2: Extract useCategoryNavigation Hook**
- Create `hooks/useCategoryNavigation.ts`
- Extract navigation logic from CategoryBottomSheet
- Expose: `navigationPath`, `currentList`, `goDown()`, `goBack()`, `selectCurrent()`

**Task 1.3: Create Search History Service**
- Create `services/searchHistoryService.ts`
- Methods: `addSearchToHistory()`, `getRecentSearches()`, `clearHistory()`
- Firestore path: `users/{uid}/searchHistory/`
- Limit to 20 most recent, auto-cleanup

**Task 1.4: Create Saved Searches Service**
- Create `services/savedSearchService.ts`
- Methods: `saveSearch()`, `getSavedSearches()`, `deleteSearch()`, `toggleNotifications()`
- Firestore path: `users/{uid}/savedSearches/`

#### Phase 2: Homepage Refactoring

**Task 2.1: Add Search Bar to Homepage**
- Modify `app/(tabs)/index.tsx` header section
- Add tappable search bar that opens SearchOverlay
- Keep notification button

**Task 2.2: Add Quick Category Chips**
- Add horizontal ScrollView below search bar
- Show top-level categories from `data/categories-v2.ts` (Femmes, Hommes, Enfants, Maison, Divertissement, Animaux)
- Tap opens SearchOverlay with category pre-selected

**Task 2.3: Add Recent Searches Section**
- Show max 5 recent searches on Homepage
- Horizontal chips, tap executes search
- "Voir tout" opens SearchOverlay on history tab

**Task 2.4: Implement "Pour Toi" Feed**
- Create `hooks/usePersonalizedFeed.ts`
- Extract signals from favorites: categoryIds, brands, sizes
- Query articles matching any of these signals
- Score by: exact category match (3pts), parent category (2pts), brand match (2pts), size match (1pt)
- Show top 10 scored articles in horizontal ScrollView

**Task 2.5: Implement "Près de toi" Section**
- Complete `useUserLocation()` with expo-location
- Filter articles by distance (< 10km)
- Show in horizontal ScrollView with distance badge

#### Phase 3: Search Overlay Implementation

**Task 3.1: SearchOverlay Entry Animation**
- Full-screen animated View (not Modal)
- Slide up from bottom with `react-native-reanimated`
- Handle back gesture/button to close

**Task 3.2: Implement Search Input**
- Auto-focus on open
- Debounced search (300ms)
- Clear button, cancel button
- Shows recent searches when empty

**Task 3.3: Implement Category Navigation**
- Use `useCategoryNavigation()` hook
- Breadcrumb header showing path
- Back button, "Choisir" button for intermediate selection
- Animate transition between levels

**Task 3.4: Implement Brand Picker**
- Fetch popular brands from Firestore `brands` collection
- Search/filter brands
- Multi-select, show selected count

**Task 3.5: Implement Filters UI**
- Price range slider
- Size multi-select (based on selected category)
- Condition picker
- Material/pattern pickers
- "Appliquer" button

**Task 3.6: Search Results Screen**
- Navigate to results when search executed
- Use existing `useArticleSearch()` hook
- Filter chips at top, removable
- "Sauvegarder cette recherche" button

#### Phase 4: Cloud Function for Alerts

**Task 4.1: Create Saved Search Notification Function**
- Create `functions/src/savedSearchNotifications.ts`
- Scheduled every 15 minutes
- Query all savedSearches with `notifyNewItems: true`
- For each, check for new articles matching filters since `lastNotifiedAt`
- Send FCM notification if matches found
- Update `lastNotifiedAt`

**Task 4.2: Notification Deep Link**
- Handle notification tap to open app with search pre-applied
- Use expo-notifications linking

#### Phase 5: Cleanup

**Task 5.1: Remove Search Tab**
- Delete `app/(tabs)/search.tsx`
- Remove search tab from `app/(tabs)/_layout.tsx` (lines 36-42)
- Update tab bar to 4 tabs: Accueil, Vendre, Messages, Profil

**Task 5.2: Update CategoryBottomSheet**
- Refactor to use new `useCategoryNavigation()` hook
- Reduce duplication

### Acceptance Criteria

#### Homepage
- [ ] Search bar visible in header, tapping opens SearchOverlay
- [ ] Quick category chips show 6 top-level categories
- [ ] Recent searches section shows max 5 clickable searches
- [ ] "Pour Toi" section shows personalized articles based on favorites
- [ ] "Près de toi" section shows nearby articles with distance (requires location permission)
- [ ] All sections have "Voir plus" link to relevant view

#### Search Overlay
- [ ] Opens with slide-up animation, closes with slide-down or back gesture
- [ ] Search input auto-focuses, debounced typing triggers search
- [ ] Recent searches displayed when input empty
- [ ] Category tree navigation with drill-down works correctly
- [ ] Brand picker allows multi-select with search
- [ ] All filters work: price, size, condition, material
- [ ] "Sauvegarder" button creates saved search
- [ ] Saved searches show with bell icon to toggle notifications

#### Saved Search Alerts
- [ ] Cloud Function runs every 15 minutes
- [ ] Users receive push notification when new matching items found
- [ ] Notification deep-links to search results

#### Tab Bar
- [ ] Only 4 tabs: Accueil, Vendre, Messages, Profil
- [ ] No "Recherche" tab

## Additional Context

### Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| react-native-reanimated | existing | SearchOverlay animations |
| @gorhom/bottom-sheet | existing | May keep for filters bottom sheet |
| expo-location | to install | Geolocation for "Près de toi" |
| expo-notifications | existing | Saved search alerts |

### Testing Strategy

1. **Unit Tests**
   - `useCategoryNavigation()` hook navigation logic
   - `usePersonalizedFeed()` scoring algorithm
   - SearchHistoryService CRUD operations

2. **Integration Tests**
   - SearchOverlay open/close animations
   - Search with filters returns correct results
   - Saved search creates Firestore document

3. **E2E Tests**
   - Full search flow: Homepage → SearchOverlay → Results
   - Category drill-down → Select → See filtered results
   - Save search → Toggle notification → Verify saved

### Notes

- This spec was derived from brainstorming session documented in `_bmad-output/analysis/brainstorming-session-2026-01-07.md`
- User research indicated search bar users convert better than browse-only users
- Benchmark: Vinted (simple/utilitarian), Vestiaire (granular filters), Depop (social feed)
- Expert recommendations from Party Mode session incorporated (Winston/Architect, Sally/UX, Amelia/Dev)

### Metrics to Track (Post-Launch)
- Search-to-view rate (% of searches that lead to article view)
- Time-to-first-result (seconds from opening overlay to viewing an article)
- Saved search adoption rate (% of users with at least 1 saved search)
- Alert conversion rate (% of notifications that lead to purchase)
- "Pour Toi" engagement (clicks vs impressions)
