---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8, 9]
status: ready-for-implementation
inputDocuments:
  - ux-brief-visual-search-similar-products.md
  - tech-spec-visual-search-embeddings.md
  - docs/01-project-overview.md
featureScope: Visual Search + Similar Products
---

# UX Design Specification - Seconde

**Author:** Aurelienrouchy
**Date:** 2026-01-11
**Feature:** Visual Search & AI-Powered Similar Products

---

## Context Summary

### Project: Freepe (Seconde)
Second-hand marketplace mobile app (React Native/Expo) with:
- Product listings with AI image analysis (Gemini)
- Real-time chat and offers
- Stripe payments, Shippo shipping

### Features to Design
1. **Visual Search** - Take a photo to find similar products
2. **Similar Products (Enhanced)** - AI-powered recommendations on article pages

### Technical Constraints (from Tech Spec)
- Vertex AI Multimodal Embeddings (1408-dim vectors)
- Firestore Vector Search
- ~3 second target for analysis
- Cost: ~$3.55/month estimated

### Existing Patterns (from UX Brief)
- SearchOverlay with tabs (Recherche/Catégories)
- SimilarProducts horizontal carousel
- CameraCapture component for sell flow
- Brand colors: Orange #F79F24, Dark #1C1C1E

---

## Executive Summary

### Project Vision

Enable users to discover second-hand products through visual similarity - either by photographing items they see in real life ("I want that jacket") or by finding more options similar to products they're viewing in the app. This creates a "Shazam for fashion" experience that differentiates Freepe from basic marketplace apps.

### Target Users

| User Type | Behavior | Visual Search Use Case |
|-----------|----------|------------------------|
| **Bargain Hunters** | Browse for deals, compare prices | Find similar items at better prices |
| **Fashion Seekers** | Looking for specific styles/trends | "Find me something like this" from photos |
| **Casual Browsers** | Discovery-focused, serendipitous | "More like this" from article pages |
| **Trend Followers** | Saw something on social media/IRL | Screenshot → search in app |

### Key Design Challenges

1. **Visual Search Entry Point**
   - Must be discoverable but not overwhelming the existing search UX
   - Users need to understand what it does before tapping

2. **Expectation Management**
   - AI similarity isn't perfect - some results may feel "off"
   - Need graceful handling of low/no results scenarios
   - Confidence indicators: helpful or confusing?

3. **Camera UX Differentiation**
   - Sell flow = multiple photos, create listing
   - Visual Search = one photo, find products
   - Must be clearly different experiences

4. **Loading State Design**
   - 3 seconds feels long in mobile context
   - Need engaging, informative feedback
   - Progress indication vs. simple spinner

### Design Opportunities

1. **"Magic Moment" Creation**
   - When visual search works well, it feels magical
   - Opportunity for delightful micro-interactions

2. **Engagement Multiplier**
   - Similar Products redesign could significantly increase click-through
   - Visible AI scoring adds transparency and trust

3. **Competitive Differentiation**
   - Most second-hand apps lack visual search
   - Feature can be marketing highlight

4. **Pattern Reuse**
   - Leverage existing CameraCapture, ProductCard patterns
   - Maintain consistency while adding new capability

---

## Core User Experience

### Defining Experience

**Visual Search:** The user sees something they want - IRL, on Instagram, in a magazine - opens Freepe, taps the camera icon, takes a photo, and within 3 seconds sees similar products available for purchase. The magic is in the "it just works" simplicity.

**Similar Products:** When viewing any article, users see a horizontal scroll of genuinely similar items - not just "same category" but visually/stylistically related. This transforms browsing from hunting into discovering.

### Platform Strategy

- **Mobile-first**: Camera-native experience on iOS/Android
- **Touch-optimized**: Large tap targets, swipe gestures
- **Online-required**: AI analysis needs connectivity (graceful offline handling)
- **Camera integration**: Native camera access via Expo

### Effortless Interactions

| Interaction | Effortless Design |
|-------------|-------------------|
| Access camera | One tap from search overlay |
| Take photo | Single capture, auto-quality |
| View results | Automatic transition, no extra taps |
| Browse similar | Pre-loaded on article page |
| Retry search | Easy "try again" without starting over |

### Critical Success Moments

1. **First Result Match**: User sees a product that genuinely looks similar → "This actually works!"
2. **Price Discovery**: Finding the same style cheaper → "I found a deal!"
3. **Similar Product Tap**: Clicking through from recommendations → Increased engagement
4. **Return Usage**: Coming back to use visual search again → Feature stickiness

### Experience Principles

1. **Show, Don't Tell** - Visual feedback over text, let results speak
2. **Confidence Without Arrogance** - Subtle similarity indicators, no "100% match!" claims
3. **Fast Perceived, Faster Real** - Engaging loading states that feel shorter than they are
4. **Familiar Yet Magical** - Existing patterns + delightful moments

---

## Desired Emotional Response

### Primary Emotional Goals

| Goal | Description |
|------|-------------|
| **Delight** | The "magic moment" when visual search works - creates advocacy |
| **Confidence** | Trust that AI recommendations are genuinely relevant |
| **Empowerment** | User feels they discovered something, not just shown it |
| **Anticipation** | Positive excitement during loading, not anxiety |

### Emotional Journey Mapping

| Stage | Target Emotion | Design Support |
|-------|----------------|----------------|
| Entry (tap camera) | Curiosity, ease | One-tap access, clear icon |
| Capture | Hope, simplicity | Quick capture, no complexity |
| Loading | Anticipation | Animated progress, not just spinner |
| Results (success) | Delight, accomplishment | Smooth reveal, clear matches |
| Results (no match) | Hopeful disappointment | Helpful suggestions, easy retry |
| Similar Products | Trust, discovery | Contextual labels, visible relevance |

### Micro-Emotions

**Maximize:**
- Confidence → Subtle similarity indicators
- Trust → Transparent matching (show source)
- Surprise → "You might also like" discoveries
- Accomplishment → "X products found" feedback

**Minimize:**
- Skepticism → Avoid overclaiming accuracy
- Confusion → Clear visual hierarchy
- Frustration → Fast perceived performance
- Impatience → Engaging loading states

### Design Implications

1. **Loading Animation**: Not a spinner - use pulsing/scanning effect on the photo
2. **Result Reveal**: Staggered card appearance for "discovery" feeling
3. **Empty State**: Encouraging tone, clear next actions
4. **Similarity Badge**: Small, corner position, muted unless hovered/tapped
5. **Source Photo**: Always visible in results header for trust

### Emotional Design Principles

1. **Underpromise, Overdeliver** - Set modest expectations, exceed them
2. **Progress Over Perfection** - Show partial results fast if possible
3. **Fail Gracefully** - No dead ends, always a next step
4. **Celebrate Success** - Subtle but satisfying feedback on matches

---

## UX Pattern Analysis & Inspiration

### Inspiring Products Analysis

| App | Key UX Pattern | Lesson for Freepe |
|-----|----------------|-------------------|
| **Pinterest Lens** | Camera in search bar, visual-first results | Entry point placement, grid layout |
| **ASOS Style Match** | Fashion-focused capture with guide frame | Product framing guidance |
| **Shazam** | Iconic loading animation builds anticipation | Loading state as experience |
| **Spotify** | "Because you liked X" transparency | Contextual recommendation labels |
| **Google Lens** | Source image visible in results header | Trust through transparency |

### Transferable UX Patterns

**Navigation Patterns:**
- Camera icon integrated in search bar (not hidden in menu)
- Results as extension of search, not separate flow

**Interaction Patterns:**
- Single-tap capture (no hold, no multi-photo)
- Guide frame overlay for product positioning
- Pulsing/scanning animation during analysis

**Visual Patterns:**
- Source photo thumbnail in results header
- 2-column grid for product results
- Contextual label ("Dans le même style") over similarity scores

### Anti-Patterns to Avoid

1. **Prominent similarity percentages** - Invites scrutiny, reduces magic
2. **Overwhelming result counts** - Cap at 15-20 visible initially
3. **Separate "AI Search" section** - Integrate into main search flow
4. **Complex capture flow** - One tap, one photo, done
5. **Generic labels** - "Similar Products" feels robotic

### Design Inspiration Strategy

| Strategy | Implementation |
|----------|----------------|
| **Adopt** | Pinterest camera placement, Shazam loading animation |
| **Adapt** | ASOS guide frame (simplified), Spotify labels (shorter) |
| **Avoid** | Percentage badges, separate AI section, multi-step capture |

---

## Design System Foundation

### Design System Choice

**Approach:** Extend existing Freepe design system (not adopt new framework)

The current app uses React Native StyleSheet with custom components. New features will follow established patterns to maintain visual consistency and reduce cognitive load for users familiar with the app.

### Rationale for Selection

1. **Consistency**: Users already know the Freepe visual language
2. **Development Speed**: Reuse existing components (CameraCapture, ProductCard)
3. **Maintenance**: Single design system to maintain, not hybrid
4. **Technical Fit**: StyleSheet approach works well, no migration needed

### Component Strategy

| New Component | Pattern Source | Key Differences |
|---------------|----------------|-----------------|
| VisualSearchCamera | CameraCapture | Single photo, guide frame, search CTA |
| ScanningLoader | New (Animated API) | Pulsing effect with brand orange |
| VisualSearchResults | FlatList + ProductCard | Source photo header, 2-column grid |
| EnhancedSimilarProducts | SimilarProducts | Contextual labels, brand visible |

### Design Tokens Extension

```typescript
// Visual Search specific tokens
visualSearch: {
  scanPulseColor: 'rgba(247, 159, 36, 0.3)',
  guideFrameColor: 'rgba(255, 255, 255, 0.8)',
  sourcePhotoSize: 60,
}
```

### Customization Strategy

- Maintain existing color palette (#F79F24 primary, #1C1C1E dark)
- Use established spacing grid (8, 12, 16, 24)
- Apply consistent border radius (10-12px)
- Leverage existing animation patterns (spring configs from SearchOverlay)

---

## Screen Flows & Interactions

### Defining Experiences

**Visual Search:** "Point your phone at anything, find it on Freepe"
- The Shazam-for-fashion moment that creates word-of-mouth

**Similar Products:** "Discover more like this, effortlessly"
- Passive discovery that increases engagement

### User Mental Model

Users expect camera-to-results simplicity (Google Lens, Pinterest). They bring:
- Familiarity with visual search concept
- Expectation of instant results
- Low tolerance for complex flows

Current pain: "I know what I want visually but can't describe it in text"

### Success Criteria

| Metric | Target |
|--------|--------|
| Time to results | < 3 seconds |
| Relevance (top 3) | User perceives match |
| Flow simplicity | 2 taps maximum |
| Retry ease | One-tap retry available |

### Experience Mechanics - Visual Search

| Stage | User Action | System Response |
|-------|-------------|-----------------|
| Entry | Tap camera icon | Full-screen camera with guide |
| Capture | Tap shutter | Haptic + capture |
| Loading | Wait | Scanning animation on photo |
| Results | Browse/tap | Grid reveal with source header |
| Retry | Tap retry | Return to camera |

### Experience Mechanics - Similar Products

| Stage | User Action | System Response |
|-------|-------------|-----------------|
| View article | Scroll down | Section auto-loads |
| Browse | Horizontal scroll | Reveal more products |
| Select | Tap product | Navigate to article |

---

## Visual Design Foundation

### Color System

**Existing Palette (Maintained):**
- Primary: #F79F24 (Orange) - CTAs, camera icon, prices
- Dark: #1C1C1E - Text, headers
- Light: #F2F2F7 - Backgrounds, cards
- Success: #34C759 - Positive states
- Error: #FF3B30 - Warnings

**New Feature Colors:**
- Scan pulse: rgba(247, 159, 36, 0.3)
- Guide frame: rgba(255, 255, 255, 0.8)
- Similarity badge: #FFFFFF on rgba(0,0,0,0.6)

### Typography System

System fonts with established hierarchy:
- Headers: 18px/700
- Body: 16px/400
- Secondary: 14px/400 #8E8E93
- Price: 16px/700 #F79F24

### Spacing & Layout Foundation

8px base grid:
- Tap targets: 44px minimum
- Section padding: 16px
- Card gaps: 12px
- Guide frame inset: 32px

### Accessibility Considerations

- WCAG AA contrast compliance
- 44px minimum tap targets
- Reduced motion support
- Screen reader labels for camera/results
- Non-color-dependent similarity indicators

---

## Design Direction Decision

### Screens Designed

1. **SearchOverlay** - Camera icon added to header (24px, #F79F24)
2. **VisualSearchCamera** - Full-screen with guide frame corners
3. **VisualSearchLoading** - Scanning animation over photo
4. **VisualSearchResults** - Source photo header + 2-column grid
5. **EnhancedSimilarProducts** - Contextual labels + brand display

### Chosen Direction

**Evolution, not revolution** - Extend existing Freepe patterns with:
- New camera entry point (proven Pinterest placement)
- Shazam-inspired loading animation (builds anticipation)
- Standard grid results (familiar shopping pattern)
- Enhanced labels for Similar Products (transparency)

### Implementation Priority

| Priority | Component | Effort |
|----------|-----------|--------|
| P1 | Firestore Vector Index + generateEmbedding trigger | 2h |
| P2 | getSimilarProducts Cloud Function | 1h |
| P3 | Update SimilarProducts.tsx | 1h |
| P4 | visualSearch Cloud Function | 2h |
| P5 | VisualSearchCamera component | 2h |
| P6 | VisualSearchResults screen | 2h |
| P7 | SearchOverlay camera integration | 1h |

---

*Document ready for implementation - UX Design Workflow completed*

