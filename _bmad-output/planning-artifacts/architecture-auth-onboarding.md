---
stepsCompleted: [1, 2, 3, 4, 5]
inputDocuments:
  - brainstorming-session-2026-01-12.md
  - docs/03-architecture.md
workflowType: 'architecture'
project_name: 'Seconde'
user_name: 'Aurelienrouchy'
date: '2026-01-12'
scope: 'Authentication & Onboarding Redesign'
---

# Architecture Decision Document
## Authentication & Onboarding Redesign

_Ce document définit les décisions architecturales pour la refonte du système d'authentification et d'onboarding de Seconde._

---

## 1. Context & Scope

### Périmètre
- Refonte complète du flow d'authentification
- Passage d'un modèle "Gate First" à "Browse First"
- Suppression de l'onboarding traditionnel
- Inscription contextuelle basée sur les triggers d'action

### Input Documents
- Brainstorming Session (2026-01-12) - Décisions UX validées
- Architecture existante (docs/03-architecture.md)

---

## 2. Project Context Analysis

### Requirements Overview

**Functional Requirements:**
- FR1: Remove Facebook authentication provider
- FR2: Implement "Browse First" - feed accessible without account
- FR3: Contextual registration on 6 value-action triggers
- FR4: Fix routing to check onboardingCompleted on reconnection
- FR5: Remove traditional onboarding flow
- FR6: IP-based geolocation + optional GPS filter
- FR7: Track anonymous user behavior for preference deduction
- FR8: Deduce sizes from liked/viewed articles
- FR9: Deduce favorite brands from behavior
- FR10: Merge guest preferences to user profile on signup
- FR11: Generate style profile with Gemini AI
- FR12: Display "Pour toi" personalized section

**Non-Functional Requirements:**
- Performance: Feed must load without auth delay
- UX: Seamless guest-to-authenticated transition
- Privacy: Clear about data collection, GDPR compliant
- Security: Server-side trigger protection
- Cost: Gemini API costs ~1€/1000 signups

### Scale & Complexity

- Primary domain: Mobile Full-Stack (Expo + Firebase)
- Complexity level: Medium-High
- Estimated files to modify: 10-15
- Risk level: Medium

---

## 3. Personalization Architecture (Hybrid Approach)

### Overview

Système hybride combinant calculs locaux (rapides, gratuits) et Gemini AI (profil style intelligent).

### Guest Session Tracking

```typescript
// AsyncStorage structure
interface GuestSession {
  guestId: string;                    // UUID généré au premier lancement
  likedArticles: ArticleMeta[];       // {id, brand, size, price, category}
  searches: string[];                 // Historique recherches
  viewedArticles: string[];           // IDs articles vus > 3 secondes
  createdAt: Date;
}
```

### Local Calculation (Client-side)

```typescript
interface LocalPreferences {
  topBrands: string[];                // Top 3-5 marques des likes
  probableSizes: { top: string; bottom: string };
  priceRange: { min: number; max: number };
  topCategories: string[];
}
```

Trigger: Après ~15 interactions (likes + recherches)

### Gemini Style Profile (Server-side)

```typescript
// Cloud Function: generateStyleProfile
interface StyleProfile {
  styleTags: string[];                // ["Streetwear", "Vintage", "Casual"]
  styleDescription: string;           // Description naturelle du style
  recommendedBrands: string[];        // Marques suggérées
  suggestedSizes: { top: string; bottom: string };
  confidence: number;                 // 0-1 score de confiance
  generatedAt: Date;
}
```

Trigger: Au signup, après merge des données guest

### Data Flow

```
Guest Browse → AsyncStorage local → 15 interactions
                                          ↓
                               Calcul local (instantané)
                                          ↓
                                    User Signup
                                          ↓
                         Cloud Function: generateStyleProfile
                                          ↓
                              Gemini API (gemini-3-flash-preview)
                                          ↓
                         Firestore: users/{uid}/preferences
                                          ↓
                              Section "Pour toi" alimentée
```

### Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `services/guestPreferencesService.ts` | CREATE | AsyncStorage guest management |
| `hooks/useGuestTracking.ts` | CREATE | Track behavior hook |
| `functions/src/generateStyleProfile.ts` | CREATE | Cloud Function + Gemini |
| `services/userService.ts` | MODIFY | Merge guest prefs on signup |
| `components/ForYouSection.tsx` | CREATE | "Pour toi" section component |
| `app/(tabs)/index.tsx` | MODIFY | Display "Pour toi" section |

### Cost Estimate

| Volume | Monthly Cost |
|--------|--------------|
| 1,000 signups | ~1€ |
| 10,000 signups | ~10€ |

---

## 4. Existing Technology Stack (Documented)

### Overview

Projet brownfield - stack déjà établi et fonctionnel.

### Mobile Application

| Layer | Technology | Version |
|-------|------------|---------|
| **Framework** | Expo | SDK 52+ |
| **Runtime** | React Native | 0.76+ |
| **Language** | TypeScript | 5.x |
| **Navigation** | Expo Router | File-based |
| **State** | React Context | Native |
| **UI Components** | Custom + @gorhom/bottom-sheet | - |
| **Gestures** | react-native-gesture-handler | - |

### Backend (Firebase)

| Service | Usage |
|---------|-------|
| **Authentication** | Email, Google, Apple, ~~Facebook~~ |
| **Firestore** | Primary database |
| **Cloud Storage** | Images, media |
| **Cloud Functions** | Backend logic, Gemini AI |
| **Cloud Messaging** | Push notifications |

### External Services

| Service | Purpose |
|---------|---------|
| **Stripe** | Payments |
| **Shippo** | Shipping labels & tracking |
| **Google Gemini** | AI product analysis (gemini-3-flash-preview) |

### Project Structure

```
app/                    # Expo Router screens
├── (tabs)/            # Tab navigator
├── settings/          # Settings stack
├── article/[id]       # Dynamic routes
└── ...

components/            # Reusable UI
contexts/              # React Context providers
services/              # Business logic & API
hooks/                 # Custom hooks
types/                 # TypeScript definitions
functions/             # Firebase Cloud Functions
```

### Key Architectural Patterns

| Pattern | Implementation |
|---------|----------------|
| **Auth State** | AuthContext + Firebase onAuthStateChanged |
| **Data Fetching** | Direct Firestore SDK calls in services |
| **Navigation** | File-based routing (Expo Router) |
| **Forms** | Controlled components |
| **Modals** | @gorhom/bottom-sheet |

### Constraints for New Development

- Must use Firebase modular API (`import { x } from 'firebase/...'`)
- Bottom sheets use `show()`/`hide()` not `present()`/`dismiss()`
- Timer types: `ReturnType<typeof setTimeout>` for cross-platform
- Gemini model: `gemini-3-flash-preview` only

---

## 5. Core Architectural Decisions

### Decision Summary

| # | Category | Decision | Rationale |
|---|----------|----------|-----------|
| 1 | Guest State | Extend `AuthContext` with `isGuest` + `guestSession` | Single source of truth, reactive |
| 2 | Firestore Access | Public read on `articles` collection | Standard marketplace pattern |
| 3 | Routing | Remove onboarding, always → `/(tabs)` | Browse First paradigm |
| 4 | Auth Triggers | Extend `AuthRequiredContext` with contextual message + callback | Reuse existing, enhance UX |
| 5 | Facebook Auth | Complete removal (code + dependencies) | No existing FB users |

### Decision Details

#### 5.1 Guest State Management

**Extend AuthContext:**

```typescript
interface AuthContextType {
  // Existing
  user: User | null;
  isLoading: boolean;
  signIn: (user: User) => Promise<void>;
  signOut: () => Promise<void>;

  // NEW - Guest support
  isGuest: boolean;
  guestSession: GuestSession | null;
  initGuestSession: () => Promise<void>;
  mergeGuestToUser: (userId: string) => Promise<void>;
}

interface GuestSession {
  guestId: string;
  likedArticles: ArticleMeta[];
  searches: string[];
  viewedArticles: string[];
  createdAt: Date;
}
```

**Files to modify:**
- `contexts/AuthContext.tsx` - Add guest state and methods

#### 5.2 Firestore Security Rules

**Update rules for public article access:**

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Articles - PUBLIC READ
    match /articles/{articleId} {
      allow read: if true;
      allow create: if request.auth != null;
      allow update, delete: if request.auth != null
        && request.auth.uid == resource.data.sellerId;
    }

    // Users - Private
    match /users/{userId} {
      allow read, write: if request.auth != null
        && request.auth.uid == userId;
    }

    // Other collections remain authenticated
  }
}
```

**Files to modify:**
- `firestore.rules`

#### 5.3 Simplified Routing

**Remove onboarding flow entirely:**

```typescript
// app/index.tsx - NEW
export default function IndexScreen() {
  const { isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading) {
      router.replace('/(tabs)');
    }
  }, [isLoading]);

  return <SplashScreen />;
}
```

**Files to modify:**
- `app/index.tsx` - Simplify routing
- `app/onboarding.tsx` - DELETE
- `components/onboarding/*` - DELETE

#### 5.4 Enhanced Auth Triggers

**Extend AuthRequiredContext:**

```typescript
interface AuthRequiredContextType {
  requireAuth: (options?: AuthRequiredOptions) => boolean;
  showAuthModal: (options?: AuthRequiredOptions) => void;
}

interface AuthRequiredOptions {
  message?: string;           // Contextual message
  onSuccess?: () => void;     // Callback after successful auth
  onCancel?: () => void;      // Callback if user cancels
}

// Usage
const { requireAuth } = useAuthRequired();

const handleLike = () => {
  requireAuth({
    message: "Crée un compte pour sauvegarder tes coups de coeur",
    onSuccess: () => likeArticle(articleId)
  });
};
```

**Files to modify:**
- `contexts/AuthRequiredContext.tsx` - Add options support
- Components using `requireAuth()` - Add contextual messages

#### 5.5 Facebook Auth Removal

**Complete removal:**

```bash
# Dependencies to remove
yarn remove react-native-fbsdk-next

# Code to remove
- authService.ts: signInWithFacebook method
- auth.tsx: Facebook button and handler
- app.json: Facebook config
```

**Files to modify:**
- `services/authService.ts` - Remove FB method
- `app/auth.tsx` - Remove FB button
- `app.json` - Remove FB config
- `package.json` - Remove dependency

---

## 6. Implementation Patterns & Consistency Rules

### Existing Patterns (Respect These)

| Category | Established Pattern |
|----------|---------------------|
| Variables | camelCase |
| Components | PascalCase |
| Files | kebab-case or PascalCase by type |
| API | Direct Firebase SDK, no custom wrapper |
| State | React Context + hooks |
| Async | async/await with try/catch |

### New Patterns for Auth/Onboarding Refactor

#### Pattern 1: Guest Session Storage

```typescript
// Prefix AsyncStorage keys for guest data
const GUEST_KEYS = {
  SESSION: '@guest_session',
  LIKED: '@guest_liked_articles',
  SEARCHES: '@guest_searches',
  VIEWED: '@guest_viewed_articles',
} as const;

// Always include timestamps
interface GuestSession {
  guestId: string;
  createdAt: string;      // ISO string
  updatedAt: string;      // ISO string
  likedArticles: ArticleMeta[];
  searches: string[];
  viewedArticles: string[];
}
```

#### Pattern 2: Auth Trigger Messages

```typescript
// Centralized contextual messages
const AUTH_MESSAGES = {
  like: "Crée un compte pour sauvegarder tes coups de coeur",
  message: "Inscris-toi pour contacter le vendeur",
  buy: "Crée un compte pour finaliser ton achat",
  sell: "Inscris-toi pour vendre tes articles",
  follow: "Crée un compte pour suivre ce vendeur",
  swapParty: "Inscris-toi pour participer à cette Swap Party",
} as const;

// Always use the helper with message
const { requireAuth } = useAuthRequired();
requireAuth({
  message: AUTH_MESSAGES.like,
  onSuccess: () => handleLike()
});
```

#### Pattern 3: Preference Tracking

```typescript
// Track interactions with minimal metadata
interface ArticleMeta {
  id: string;
  brand: string;
  size: string;
  price: number;
  category: string;
  timestamp: string;  // ISO string
}

// Dedicated hook for tracking
const { trackView, trackLike, trackSearch } = useGuestTracking();

// Usage in components
useEffect(() => {
  if (isGuest) {
    trackView({ id, brand, size, price, category });
  }
}, []);
```

#### Pattern 4: Gemini Style Profile

```typescript
// Structured prompt with JSON output
const STYLE_PROFILE_PROMPT = `
Analyse ces articles likés et recherches.
Génère un profil style en JSON valide uniquement:
{
  "styleTags": ["tag1", "tag2", "tag3"],
  "styleDescription": "Description courte en français",
  "recommendedBrands": ["brand1", "brand2"],
  "suggestedSizes": {"top": "M", "bottom": "L"},
  "confidence": 0.85
}
`;

// Response validation interface
interface StyleProfile {
  styleTags: string[];
  styleDescription: string;
  recommendedBrands: string[];
  suggestedSizes: { top: string; bottom: string };
  confidence: number;
}

// Fallback if Gemini fails
const DEFAULT_PROFILE: StyleProfile = {
  styleTags: [],
  styleDescription: "",
  recommendedBrands: [],
  suggestedSizes: { top: "", bottom: "" },
  confidence: 0,
};
```

### Enforcement Guidelines

**All implementations MUST:**
- Use `GUEST_KEYS` constants for AsyncStorage
- Use `AUTH_MESSAGES` for auth trigger messages
- Include `timestamp` in all tracked data
- Handle Gemini failures with `DEFAULT_PROFILE`
- Use `useGuestTracking` hook for behavior tracking

---

## 7. Implementation Roadmap

### Files to Create

| File | Purpose |
|------|---------|
| `services/guestPreferencesService.ts` | AsyncStorage guest session management |
| `hooks/useGuestTracking.ts` | Behavior tracking hook |
| `functions/src/generateStyleProfile.ts` | Cloud Function + Gemini |
| `components/ForYouSection.tsx` | "Pour toi" personalized section |
| `constants/authMessages.ts` | Centralized auth trigger messages |

### Files to Modify

| File | Changes |
|------|---------|
| `contexts/AuthContext.tsx` | Add `isGuest`, `guestSession`, merge methods |
| `contexts/AuthRequiredContext.tsx` | Add `message` + `onSuccess` options |
| `services/authService.ts` | Remove Facebook auth method |
| `services/userService.ts` | Add preference merge on signup |
| `app/index.tsx` | Simplify routing (always → tabs) |
| `app/auth.tsx` | Remove Facebook button |
| `app/(tabs)/index.tsx` | Add "Pour toi" section |
| `firestore.rules` | Public read on articles |
| `app.json` | Remove Facebook config |
| `package.json` | Remove `react-native-fbsdk-next` |

### Files to Delete

| File | Reason |
|------|--------|
| `app/onboarding.tsx` | Onboarding removed |
| `components/onboarding/OnboardingFlow.tsx` | Onboarding removed |
| `components/onboarding/*` | Onboarding removed |

### Implementation Order

```
Phase 1: Foundation
├── 1. Remove Facebook Auth (authService, auth.tsx, package.json)
├── 2. Update Firestore rules (public read articles)
└── 3. Simplify routing (index.tsx)

Phase 2: Guest Experience
├── 4. Create guestPreferencesService.ts
├── 5. Extend AuthContext with guest state
├── 6. Create useGuestTracking hook
└── 7. Extend AuthRequiredContext with options

Phase 3: Personalization
├── 8. Create generateStyleProfile Cloud Function
├── 9. Add preference merge on signup
├── 10. Create ForYouSection component
└── 11. Integrate "Pour toi" on home

Phase 4: Cleanup
├── 12. Delete onboarding files
├── 13. Update auth trigger messages across app
└── 14. Test full flow
```

---

## 8. Document Complete

**Architecture Document:** `_bmad-output/planning-artifacts/architecture-auth-onboarding.md`

**Related Documents:**
- Brainstorming Session: `_bmad-output/analysis/brainstorming-session-2026-01-12.md`

**Ready for Implementation.**

---

