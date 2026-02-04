---
stepsCompleted: ['step-01-validate-prerequisites', 'step-02-design-epics', 'step-03-create-stories']
inputDocuments:
  - '_bmad-output/planning-artifacts/ux-spec-ai-product-creation.md'
---

# Seconde - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for Seconde AI-Powered Product Creation feature, decomposing the requirements from the UX Specification into implementable stories.

## Requirements Inventory

### Functional Requirements

**Photo Capture (Step 1)**
- FR1: User can take photos using device camera
- FR2: User can select photos from device gallery (multiple selection)
- FR3: User can add up to 5 photos maximum
- FR4: User can remove individual photos from selection
- FR5: User can reorder photos by tapping (make primary)
- FR6: System displays photo count in real-time (X/5)
- FR7: System requests camera permission on first access
- FR8: System falls back to gallery-only if camera permission denied
- FR9: "Analyze with AI" button appears when 1+ photos selected
- FR10: Capture button disabled when 5 photos reached

**AI Analysis (Step 1→2 Transition)**
- FR11: System analyzes first photo using Gemini AI on button tap
- FR12: AI extracts: title, description, category, condition, colors, materials, sizes, brand, package size
- FR13: System displays loading animation during AI analysis
- FR14: System handles AI timeout (>10s) with manual entry fallback
- FR15: System handles invalid AI response with manual entry fallback
- FR16: System maps AI category response to existing category IDs

**Results & Editing (Step 2)**
- FR17: System displays AI-generated title with inline edit capability
- FR18: System displays AI-generated description with inline edit capability
- FR19: System displays category with icon + name + subtle context (not breadcrumb)
- FR20: System displays condition as dropdown (4 options)
- FR21: System displays detected colors as SmartSelector chips + full list access
- FR22: System displays detected materials as SmartSelector chips + full list access
- FR23: System displays suggested sizes as SmartSelector chips + full list access
- FR24: User can add brand manually via text input (optional)
- FR25: System shows confidence indicator (High/Medium/Low) per AI field
- FR26: System shows "To Complete" section for unfilled required fields
- FR27: User can tap any field to edit inline with cancel/confirm actions

**Pricing & Delivery (Step 3)**
- FR28: User can enter price via large centered numeric input
- FR29: User can toggle hand delivery option (checkbox)
- FR30: User can toggle shipping option (checkbox)
- FR31: User selects neighborhood via bottom sheet (if hand delivery enabled)
- FR32: User selects package size from 3 cards (if shipping enabled)
- FR33: System auto-suggests package size based on detected category
- FR34: At least one delivery option must be selected (validation)
- FR35: Neighborhood required if hand delivery selected (validation)
- FR36: Package size required if shipping selected (validation)

**Preview & Publication (Step 4)**
- FR37: System displays full article preview matching buyer view
- FR38: User can swipe through photo carousel with dot indicators
- FR39: User can tap "Modify" to return to step 2 with data preserved
- FR40: User can publish article via primary button
- FR41: System shows loading spinner during publication
- FR42: System shows success animation (confetti/check) on publish
- FR43: System redirects to "My Articles" after successful publish
- FR44: System shows toast "Article publié avec succès!"

**Draft Management**
- FR45: System auto-saves draft when photo added (step 1)
- FR46: System auto-saves draft after AI analysis completes (step 2)
- FR47: System auto-saves draft on any field modification (debounced 500ms)
- FR48: System auto-saves draft on step navigation
- FR49: System auto-saves draft when app goes to background
- FR50: System copies images locally for draft persistence
- FR51: System shows draft resume modal on sell tab launch (if draft exists)
- FR52: User can choose "Resume draft" or "Start new article"
- FR53: "Start new" deletes existing draft before proceeding
- FR54: System shows subtle save indicator in header (💾 "Saved")
- FR55: System expires drafts after 14 days with auto-deletion
- FR56: System warns about expiring drafts (7-14 days old)
- FR57: System deletes draft after successful publication

**Navigation & UX**
- FR58: System displays step progress indicator (4 steps)
- FR59: User can navigate back to previous step
- FR60: System confirms exit if photos taken and user closes (step 1)
- FR61: Hardware back button mirrors UI back behavior
- FR62: Step transitions use push navigation (enables back)

### NonFunctional Requirements

**Performance**
- NFR1: Article creation time target: < 90 seconds end-to-end
- NFR2: AI analysis timeout threshold: 10 seconds max
- NFR3: Draft save debounce interval: 500ms
- NFR4: Animation durations: 150-300ms for UI transitions

**Quality Metrics**
- NFR5: Completion rate target: > 80% of started articles published
- NFR6: AI field edit rate target: < 30% of fields modified by user
- NFR7: AI category accuracy target: > 85% correct on first suggestion
- NFR8: User satisfaction (NPS) target: > 40

**Technical Constraints**
- NFR9: Draft expiration: 14 days maximum retention
- NFR10: Maximum photos per article: 5
- NFR11: Gemini API cost budget: ~$0.003-0.005 per article analysis

**Design Standards**
- NFR12: Primary action color: #F79F24 (Orange)
- NFR13: AI accent color: #8B5CF6 (Violet)
- NFR14: Confidence High: #22C55E (Green)
- NFR15: Confidence Medium: #F79F24 (Orange)
- NFR16: Confidence Low: #EF4444 (Red)

### Additional Requirements

**Infrastructure & Services**
- Setup Firebase Vertex AI / Gemini API integration
- Create AIService for Gemini API calls with structured prompts
- Create DraftService for AsyncStorage-based draft persistence
- Implement image caching using expo-file-system for drafts
- Configure category mapping from AI response to existing categoryIds

**Navigation Architecture**
- Create new /sell/* stack navigator structure
- Restructure sell.tsx as entry point with draft check
- Create 4 new screens: capture.tsx, details.tsx, pricing.tsx, preview.tsx

**New Components (10 total)**
- CameraCapture: Full-screen camera with gallery access
- AIAnalysisLoader: Animated loading state during AI processing
- EditableField: Inline editable text with cancel/confirm
- ConfidenceIndicator: Badge showing AI confidence level
- ProductPreview: Article preview matching buyer view
- StepIndicator: Horizontal progress bar for 4 steps
- SmartSelector: Chips + bottom sheet hybrid selector
- CategoryDisplay: Icon + name + context category display
- DraftResumeModal: Draft resume/discard dialog
- SaveIndicator: Subtle save status indicator

**Component Modifications**
- CategoryBottomSheet: Add initialValue prop for pre-selection
- SelectionBottomSheet: Add initialValue prop for pre-selection

**Dependencies**
- expo-camera (camera access)
- expo-image-picker (gallery access)
- expo-file-system (image caching)
- @react-native-async-storage/async-storage (draft persistence)
- Firebase Vertex AI SDK (Gemini API)

### FR Coverage Map

| FR | Epic | Description |
|----|------|-------------|
| FR1 | Epic 1 | Camera photo capture |
| FR2 | Epic 1 | Gallery photo selection |
| FR3 | Epic 1 | Max 5 photos limit |
| FR4 | Epic 1 | Remove photos |
| FR5 | Epic 1 | Reorder photos |
| FR6 | Epic 1 | Photo count display |
| FR7 | Epic 1 | Camera permission request |
| FR8 | Epic 1 | Gallery fallback |
| FR9 | Epic 1 | Analyze button visibility |
| FR10 | Epic 1 | Capture button disable at max |
| FR11 | Epic 1 | Gemini AI analysis trigger |
| FR12 | Epic 1 | AI data extraction |
| FR13 | Epic 1 | Loading animation |
| FR14 | Epic 1 | AI timeout handling |
| FR15 | Epic 1 | Invalid response fallback |
| FR16 | Epic 1 | Category ID mapping |
| FR17 | Epic 2 | AI title display + edit |
| FR18 | Epic 2 | AI description display + edit |
| FR19 | Epic 2 | Category display (icon + context) |
| FR20 | Epic 2 | Condition dropdown |
| FR21 | Epic 2 | Colors SmartSelector |
| FR22 | Epic 2 | Materials SmartSelector |
| FR23 | Epic 2 | Sizes SmartSelector |
| FR24 | Epic 2 | Brand manual input |
| FR25 | Epic 2 | Confidence indicators |
| FR26 | Epic 2 | "To Complete" section |
| FR27 | Epic 2 | Inline edit behavior |
| FR28 | Epic 3 | Price input |
| FR29 | Epic 3 | Hand delivery toggle |
| FR30 | Epic 3 | Shipping toggle |
| FR31 | Epic 3 | Neighborhood selection |
| FR32 | Epic 3 | Package size selection |
| FR33 | Epic 3 | Package size AI suggestion |
| FR34 | Epic 3 | Delivery validation |
| FR35 | Epic 3 | Neighborhood validation |
| FR36 | Epic 3 | Package size validation |
| FR37 | Epic 4 | Article preview display |
| FR38 | Epic 4 | Photo carousel |
| FR39 | Epic 4 | Modify button |
| FR40 | Epic 4 | Publish button |
| FR41 | Epic 4 | Publish loading state |
| FR42 | Epic 4 | Success animation |
| FR43 | Epic 4 | Redirect to My Articles |
| FR44 | Epic 4 | Success toast |
| FR45 | Epic 5 | Auto-save on photo add |
| FR46 | Epic 5 | Auto-save after AI |
| FR47 | Epic 5 | Auto-save on field edit |
| FR48 | Epic 5 | Auto-save on step change |
| FR49 | Epic 5 | Auto-save on background |
| FR50 | Epic 5 | Image local copy |
| FR51 | Epic 5 | Draft resume modal |
| FR52 | Epic 5 | Resume/new choice |
| FR53 | Epic 5 | Delete draft on new |
| FR54 | Epic 5 | Save indicator |
| FR55 | Epic 5 | Draft expiration |
| FR56 | Epic 5 | Expiration warning |
| FR57 | Epic 5 | Delete draft on publish |
| FR58 | Epic 1 | Step progress indicator |
| FR59 | Epic 1 | Back navigation |
| FR60 | Epic 1 | Exit confirmation |
| FR61 | Epic 1 | Hardware back behavior |
| FR62 | Epic 1 | Push navigation |

## Epic List

### Epic 1: Photo Capture & AI Analysis
L'utilisateur peut prendre des photos de son article et obtenir instantanément des suggestions intelligentes générées par l'IA (titre, description, catégorie, couleurs, matières, état).

**User Outcome:** "Je prends une photo, l'IA analyse et pré-remplit tous les détails de mon annonce"

**FRs covered:** FR1-FR16, FR58-FR62 (21 FRs)

**Key Deliverables:**
- Navigation structure /sell/* avec 4 écrans
- CameraCapture component avec galerie
- AIService avec intégration Gemini
- AIAnalysisLoader animation
- StepIndicator component
- Gestion permissions caméra

---

### Epic 2: Smart Product Details
L'utilisateur peut visualiser les suggestions de l'IA avec des indicateurs de confiance, et les modifier facilement via des sélecteurs intelligents (SmartSelector) ou l'édition inline.

**User Outcome:** "Je vois ce que l'IA a détecté avec son niveau de confiance, je corrige en 2 taps si nécessaire"

**FRs covered:** FR17-FR27 (11 FRs)

**Key Deliverables:**
- SmartSelector component (chips IA + liste complète)
- EditableField component (inline edit)
- ConfidenceIndicator component
- CategoryDisplay component (icône + nom + contexte)
- Écran details.tsx complet

---

### Epic 3: Pricing & Delivery
L'utilisateur configure son prix de vente et ses options de livraison (remise en main propre avec sélection de quartier, et/ou expédition avec taille de colis suggérée par l'IA).

**User Outcome:** "Je fixe mon prix et choisis comment je veux vendre - meetup, livraison, ou les deux"

**FRs covered:** FR28-FR36 (9 FRs)

**Key Deliverables:**
- Écran pricing.tsx
- Input prix centré avec clavier numérique
- Cartes checkbox livraison
- Intégration NeighborhoodBottomSheet existant
- Cartes sélection taille colis avec suggestion IA

---

### Epic 4: Preview & Publication
L'utilisateur peut prévisualiser son annonce exactement comme les acheteurs la verront, puis la publier avec une animation de succès et redirection vers ses articles.

**User Outcome:** "Je vérifie mon annonce, je publie, et je vois une confirmation satisfaisante"

**FRs covered:** FR37-FR44 (8 FRs)

**Key Deliverables:**
- Écran preview.tsx
- ProductPreview component
- Carousel photos avec indicateurs
- Flow de publication avec loading
- Animation succès (confetti/check)
- Redirection + toast

---

### Epic 5: Draft Persistence
L'utilisateur ne perd jamais son travail grâce à la sauvegarde automatique. Il peut quitter l'app et reprendre son brouillon plus tard, avec gestion de l'expiration.

**User Outcome:** "Si je suis interrompu, je retrouve mon brouillon au retour - rien n'est perdu"

**FRs covered:** FR45-FR57 (13 FRs)

**Key Deliverables:**
- DraftService avec AsyncStorage
- Auto-save sur tous les événements clés
- Copie locale des images
- DraftResumeModal component
- SaveIndicator component
- Logique d'expiration (14 jours)

---

## Epic 1: Photo Capture & AI Analysis - Stories

### Story 1.1: Navigation Structure & Sell Flow Setup

**As a** seller,
**I want** to access a dedicated multi-step selling flow,
**So that** I can create my listing through a guided experience.

**Acceptance Criteria:**

**Given** I am on the main app
**When** I tap the "Sell" tab
**Then** I am navigated to the sell flow entry point

**Given** I am in the sell flow
**When** the screen loads
**Then** I see a step indicator showing "Step 1/4"
**And** I see a close (✕) button in the header

**Given** I am in step 1
**When** I tap the back/close button
**Then** I am returned to the previous screen

**Given** I press the hardware back button
**When** I am in the sell flow
**Then** the behavior matches the UI back button

---

### Story 1.2: Camera & Gallery Photo Capture

**As a** seller,
**I want** to take photos with my camera or select from my gallery,
**So that** I can add images of my item to sell.

**Acceptance Criteria:**

**Given** I am on the capture screen
**When** the screen loads for the first time
**Then** the system requests camera permission

**Given** camera permission is granted
**When** I view the capture screen
**Then** I see a live camera viewfinder
**And** I see a capture button (📸)
**And** I see a gallery button (🖼️)

**Given** I tap the capture button
**When** the camera is active
**Then** a photo is taken and added to my selection

**Given** I tap the gallery button
**When** the gallery opens
**Then** I can select multiple photos at once

**Given** camera permission is denied
**When** I try to use the capture screen
**Then** I can still access the gallery as fallback
**And** I see a message explaining camera access is needed

---

### Story 1.3: Photo Management & Display

**As a** seller,
**I want** to manage my selected photos (view, remove, reorder),
**So that** I can control which images represent my item.

**Acceptance Criteria:**

**Given** I have selected photos
**When** I view the capture screen
**Then** I see thumbnails in a horizontal scroll
**And** I see a counter "Photos: X/5"

**Given** I have 5 photos selected
**When** I try to add more
**Then** the capture button is disabled
**And** I see "Maximum atteint" message

**Given** I tap a thumbnail
**When** viewing my photos
**Then** that photo becomes the primary (first) photo

**Given** I tap the remove (✕) on a thumbnail
**When** viewing my photos
**Then** that photo is removed from selection
**And** the counter updates

**Given** I have 1+ photos selected
**When** viewing the capture screen
**Then** the "Analyser avec l'IA" button appears

**Given** I have 0 photos
**When** viewing the capture screen
**Then** the analyze button is hidden

**Given** I have photos and tap close (✕)
**When** trying to exit
**Then** I see a confirmation dialog before losing my photos

---

### Story 1.4: AI Service Integration (Gemini)

**As a** developer,
**I want** an AIService that calls Gemini API with product images,
**So that** the app can get AI-generated product details.

**Acceptance Criteria:**

**Given** an image URI is provided
**When** analyzeProductImage() is called
**Then** the image is sent to Gemini API with the structured prompt

**Given** Gemini returns a valid response
**When** processing the response
**Then** title, description, category, condition, colors, materials, sizes, brand, and packageSize are extracted

**Given** Gemini returns category path ["Femmes", "Vêtements", "Robes"]
**When** mapping to app categories
**Then** the corresponding categoryIds ["femmes", "vetements", "robes"] are returned

**Given** Gemini returns confidence scores
**When** processing the response
**Then** each field includes its confidence level (0.0-1.0)

---

### Story 1.5: AI Analysis Loading & Error Handling

**As a** seller,
**I want** to see loading feedback during AI analysis with proper error handling,
**So that** I know the app is working and can recover from failures.

**Acceptance Criteria:**

**Given** I tap "Analyser avec l'IA"
**When** the analysis starts
**Then** I see an animated loading screen (AIAnalysisLoader)
**And** the loading shows progress/pulse animation

**Given** analysis completes successfully
**When** results are ready
**Then** I am navigated to step 2 (details screen)
**And** the AI results are passed to the next screen

**Given** the AI takes more than 10 seconds
**When** waiting for response
**Then** I see "Analyse plus longue que prévu..."
**And** I am offered manual entry option

**Given** the AI returns an invalid/error response
**When** processing fails
**Then** I see an error message
**And** I can proceed with manual entry

---

## Epic 2: Smart Product Details - Stories

### Story 2.1: Details Screen Layout & AI Results Display

**As a** seller,
**I want** to see my AI-generated product details clearly displayed,
**So that** I can review what the AI detected from my photos.

**Acceptance Criteria:**

**Given** I arrive on the details screen from AI analysis
**When** the screen loads
**Then** I see my photos with the primary photo large and thumbnails below
**And** I see the step indicator showing "Step 2/4"

**Given** AI analysis provided results
**When** viewing the details screen
**Then** I see the AI-generated title displayed
**And** I see the AI-generated description displayed
**And** I see the detected category with icon + name + subtle context (e.g., "👗 Robes" with "dans Femmes · Vêtements")

**Given** each AI-detected field
**When** displayed on screen
**Then** I see a confidence indicator (🤖) with color:
- Green (#22C55E) for High (80%+)
- Orange (#F79F24) for Medium (50-80%)
- Red (#EF4444) for Low (<50%)

---

### Story 2.2: Inline Editing (Title & Description)

**As a** seller,
**I want** to edit the AI-suggested title and description inline,
**So that** I can refine the text without leaving the screen.

**Acceptance Criteria:**

**Given** I see the title field
**When** I tap on it
**Then** it becomes editable with a cursor
**And** I see "Annuler" and "Confirmer" buttons

**Given** I am editing the title
**When** I tap "Confirmer"
**Then** my changes are saved
**And** the field returns to display mode

**Given** I am editing the title
**When** I tap "Annuler"
**Then** my changes are discarded
**And** the original value is restored

**Given** I am editing the description
**When** I follow the same flow
**Then** the same inline edit behavior applies

---

### Story 2.3: SmartSelector Component

**As a** seller,
**I want** to select from AI-suggested options or access the full list,
**So that** I can quickly pick the right value or find alternatives.

**Acceptance Criteria:**

**Given** AI detected multiple options (e.g., colors)
**When** viewing the SmartSelector
**Then** I see AI suggestions as tappable chips
**And** I see a "📋 Voir toutes les [options]" link

**Given** I tap a chip
**When** it's not already selected
**Then** it becomes selected (filled style)
**And** any previously selected chip is deselected

**Given** I tap "Voir toutes les couleurs/matières/tailles"
**When** the bottom sheet opens
**Then** I see the complete list of options
**And** the currently selected value is highlighted

**Given** I select an option from the bottom sheet
**When** confirming selection
**Then** the bottom sheet closes
**And** the new value appears as selected

---

### Story 2.4: Color, Material & Size Selection

**As a** seller,
**I want** to select or change the color, material, and size of my item,
**So that** buyers can filter and find my listing.

**Acceptance Criteria:**

**Given** AI detected colors from my photo
**When** viewing the color SmartSelector
**Then** I see detected colors as chips with color dots
**And** the primary color is pre-selected

**Given** AI detected probable materials
**When** viewing the material SmartSelector
**Then** I see suggested materials as chips
**And** the primary material is pre-selected

**Given** AI provided size context (e.g., "robes femmes")
**When** viewing the size SmartSelector
**Then** I see relevant sizes as chips (S, M, L, XL, etc.)
**And** no size is pre-selected (user must choose)

**Given** I access the full color list
**When** viewing the bottom sheet
**Then** each color shows a color dot next to its name

---

### Story 2.5: Condition, Brand & Validation

**As a** seller,
**I want** to set the item condition and optionally add a brand,
**So that** my listing has complete information.

**Acceptance Criteria:**

**Given** AI detected an item condition
**When** viewing the condition field
**Then** I see a dropdown with the AI suggestion pre-selected
**And** I can choose from: Neuf, Très bon état, Bon état, Satisfaisant

**Given** AI did not detect a brand
**When** viewing the brand field
**Then** I see "+ Ajouter une marque (optionnel)"
**And** I see "ℹ️ Aucune marque détectée"

**Given** I tap the brand field
**When** it becomes active
**Then** I can type a brand name freely

**Given** required fields are missing (e.g., size for clothing)
**When** viewing the screen
**Then** I see a "⚠️ À compléter" section highlighting missing fields

**Given** all required fields are filled
**When** I tap "Continuer"
**Then** I proceed to step 3 (pricing)

---

## Epic 3: Pricing & Delivery - Stories

### Story 3.1: Pricing Screen Layout & Price Input

**As a** seller,
**I want** to set my selling price on a dedicated screen,
**So that** I can clearly define how much I want for my item.

**Acceptance Criteria:**

**Given** I arrive on the pricing screen from details
**When** the screen loads
**Then** I see the step indicator showing "Step 3/4"
**And** I see a "💰 Fixez votre prix" header

**Given** I view the price input area
**When** the screen loads
**Then** I see a large, centered price input field
**And** I see "€" symbol next to the input
**And** the placeholder shows "0.00"

**Given** I tap the price input
**When** the keyboard appears
**Then** it is a numeric keyboard
**And** I can enter decimal values

**Given** I enter a price
**When** the value is 0 or empty
**Then** the "Continuer" button remains disabled

**Given** I enter a valid price > 0
**When** viewing the screen
**Then** the "Continuer" button becomes enabled

---

### Story 3.2: Delivery Options Toggle

**As a** seller,
**I want** to choose between hand delivery and/or shipping,
**So that** buyers know how they can receive the item.

**Acceptance Criteria:**

**Given** I view the delivery section
**When** the screen loads
**Then** I see "🚚 Options de livraison" header
**And** I see two option cards:
- "Remise en main propre" with subtitle "Rencontrez l'acheteur"
- "Livraison" with subtitle "Mondial Relay, Colissimo..."

**Given** I tap a delivery option card
**When** it's unchecked
**Then** it becomes checked (checkbox filled)

**Given** I tap a checked delivery option
**When** it's the only one selected
**Then** it remains checked (cannot uncheck last option)

**Given** both options are checked
**When** I tap one of them
**Then** it becomes unchecked
**And** the other remains checked

**Given** no delivery option is selected
**When** I try to continue
**Then** I see a validation error "Sélectionnez au moins une option"

---

### Story 3.3: Hand Delivery - Neighborhood Selection

**As a** seller,
**I want** to select my meetup neighborhood when offering hand delivery,
**So that** buyers know where we can meet.

**Acceptance Criteria:**

**Given** "Remise en main propre" is checked
**When** viewing the delivery section
**Then** I see a neighborhood selector appear below the option
**And** it shows "📍 Quartier" with "Choisir un quartier ›"

**Given** I tap the neighborhood selector
**When** the bottom sheet opens
**Then** I see the NeighborhoodBottomSheet with search
**And** neighborhoods are grouped by borough

**Given** I select a neighborhood
**When** confirming selection
**Then** the bottom sheet closes
**And** the selector shows the selected neighborhood name

**Given** "Remise en main propre" is checked but no neighborhood selected
**When** I tap "Continuer"
**Then** I see a validation error "Sélectionnez un quartier"

**Given** "Remise en main propre" is unchecked
**When** viewing the delivery section
**Then** the neighborhood selector is hidden

---

### Story 3.4: Shipping - Package Size Selection

**As a** seller,
**I want** to select my package size with AI suggestion,
**So that** shipping costs can be estimated accurately.

**Acceptance Criteria:**

**Given** "Livraison" is checked
**When** viewing the delivery section
**Then** I see a package size selector appear below the option
**And** I see "📦 Taille du colis" header
**And** I see 3 cards: Petit (<500g), Moyen (<1kg), Grand (<2kg)

**Given** AI suggested a package size based on category
**When** viewing the package cards
**Then** the suggested size is pre-selected
**And** I see "✨ Suggéré par l'IA" below the cards

**Given** I tap a different package size card
**When** it's not selected
**Then** it becomes selected
**And** the previously selected card is deselected

**Given** "Livraison" is checked but no package size selected
**When** I tap "Continuer"
**Then** I see a validation error "Sélectionnez une taille de colis"

**Given** "Livraison" is unchecked
**When** viewing the delivery section
**Then** the package size selector is hidden

**Given** all validations pass (price > 0, delivery options valid)
**When** I tap "Continuer"
**Then** I proceed to step 4 (preview)

---

## Epic 4: Preview & Publication - Stories

### Story 4.1: Preview Screen Layout & Article Display

**As a** seller,
**I want** to see my listing exactly as buyers will see it,
**So that** I can verify everything looks correct before publishing.

**Acceptance Criteria:**

**Given** I arrive on the preview screen from pricing
**When** the screen loads
**Then** I see the step indicator showing "Step 4/4"
**And** I see "Vérifiez votre annonce" header

**Given** my article data is complete
**When** viewing the preview
**Then** I see my article displayed in buyer-view format:
- Title prominently displayed
- Price with 💰 icon
- Category with icon (e.g., "👗 Robes")
- Size with 📏 icon
- Condition with ✨ icon
- Color with 🎨 icon
- Material with 🧵 icon

**Given** I have a description
**When** viewing the preview
**Then** I see my description text in a dedicated section

**Given** I selected delivery options
**When** viewing the preview
**Then** I see delivery icons:
- 🚚 "Livraison disponible" (if shipping)
- 🤝 "Meetup: [Neighborhood]" (if hand delivery)

---

### Story 4.2: Photo Carousel

**As a** seller,
**I want** to swipe through my photos in the preview,
**So that** I can verify all images look good.

**Acceptance Criteria:**

**Given** I have multiple photos
**When** viewing the preview screen
**Then** I see the primary photo displayed full-width
**And** I see dot indicators below (● ○ ○ ○ ○)

**Given** I swipe left on the photo
**When** there are more photos
**Then** the next photo slides into view
**And** the dot indicators update

**Given** I swipe right on the photo
**When** there are previous photos
**Then** the previous photo slides into view
**And** the dot indicators update

**Given** I am on the last photo
**When** I swipe left
**Then** nothing happens (no circular scroll)

**Given** I have only one photo
**When** viewing the preview
**Then** the photo displays without dot indicators

---

### Story 4.3: Modify & Navigation Actions

**As a** seller,
**I want** to go back and modify my listing if needed,
**So that** I can fix any issues before publishing.

**Acceptance Criteria:**

**Given** I am on the preview screen
**When** I view the action area
**Then** I see a "✏️ Modifier" link/button
**And** I see a "✨ Publier l'article" primary button

**Given** I tap "Modifier"
**When** returning to edit
**Then** I am navigated back to step 2 (details)
**And** all my data is preserved

**Given** I make changes in step 2 after modifying
**When** I continue through the flow again
**Then** my changes are reflected in the preview

**Given** I tap the back button in header
**When** on the preview screen
**Then** I return to step 3 (pricing)
**And** my data is preserved

---

### Story 4.4: Publication Flow & Success

**As a** seller,
**I want** to publish my article with clear feedback,
**So that** I know my listing is live and can view it.

**Acceptance Criteria:**

**Given** I tap "Publier l'article"
**When** publication starts
**Then** the button shows a loading spinner
**And** the text changes to "Publication en cours..."
**And** the button is disabled

**Given** publication is in progress
**When** images are uploading
**Then** the loading state continues

**Given** publication completes successfully
**When** the article is created
**Then** I see a success animation (confetti or animated checkmark)

**Given** the success animation plays
**When** it completes (after ~2 seconds)
**Then** I am redirected to "Mes Articles" screen
**And** I see a toast "Article publié avec succès!"

**Given** publication fails
**When** an error occurs
**Then** I see an error message
**And** the button returns to normal state
**And** I can retry publication

---

## Epic 5: Draft Persistence - Stories

### Story 5.1: DraftService Foundation

**As a** developer,
**I want** a DraftService that persists article drafts,
**So that** users never lose their work in progress.

**Acceptance Criteria:**

**Given** the DraftService is initialized
**When** I call saveDraft(draft)
**Then** the draft is saved to AsyncStorage with key '@article_draft'

**Given** a draft exists in storage
**When** I call loadDraft()
**Then** the complete draft object is returned with all fields

**Given** no draft exists
**When** I call loadDraft()
**Then** null is returned

**Given** I call deleteDraft()
**When** a draft exists
**Then** the draft is removed from AsyncStorage

**Given** I call hasDraft()
**When** checking for existing draft
**Then** true/false is returned based on draft existence

**Given** a draft is saved
**When** it includes images
**Then** the draft stores image URIs and local paths

---

### Story 5.2: Image Local Caching for Drafts

**As a** seller,
**I want** my draft photos to persist even if original URIs expire,
**So that** I can resume my listing with all my photos intact.

**Acceptance Criteria:**

**Given** I add a photo to my listing
**When** the photo is selected
**Then** a local copy is created in the cache directory
**And** the local path is stored in the draft

**Given** I resume a draft
**When** loading images
**Then** images are loaded from local cache paths
**And** the photos display correctly

**Given** the app launches
**When** checking for orphaned images
**Then** draft images older than 14 days without a valid draft are deleted

**Given** I delete a draft
**When** cleanup runs
**Then** associated cached images are also deleted

---

### Story 5.3: Auto-save Triggers

**As a** seller,
**I want** my progress to be saved automatically,
**So that** I don't have to worry about losing my work.

**Acceptance Criteria:**

**Given** I add a photo (step 1)
**When** the photo is added to selection
**Then** the draft is saved with images

**Given** AI analysis completes (step 1→2)
**When** results are received
**Then** the draft is saved with AI analysis results

**Given** I modify any field (step 2 or 3)
**When** 500ms pass without further changes (debounce)
**Then** the draft is saved with updated values

**Given** I navigate between steps
**When** the step changes
**Then** the draft is saved with currentStep updated

**Given** the app goes to background
**When** AppState changes to 'background'
**Then** the draft is saved immediately

---

### Story 5.4: Draft Resume Modal

**As a** seller,
**I want** to be prompted to resume my draft when returning,
**So that** I can continue where I left off.

**Acceptance Criteria:**

**Given** I tap the Sell tab
**When** a draft exists
**Then** I see a modal "📝 Brouillon trouvé"
**And** I see a thumbnail of the first photo
**And** I see the draft title (if available)
**And** I see "Étape X/4" and "Il y a [time]"

**Given** I see the draft resume modal
**When** I tap "Reprendre le brouillon"
**Then** the modal closes
**And** I am navigated to the draft's currentStep
**And** all draft data is restored

**Given** I see the draft resume modal
**When** I tap "Commencer un nouvel article"
**Then** the existing draft is deleted
**And** cached images are cleaned up
**And** I start fresh at step 1

**Given** I tap the Sell tab
**When** no draft exists
**Then** I go directly to step 1 (capture)
**And** no modal is shown

---

### Story 5.5: Save Indicator & Expiration Handling

**As a** seller,
**I want** visual feedback when my draft saves and automatic cleanup of old drafts,
**So that** I know my work is safe and storage stays clean.

**Acceptance Criteria:**

**Given** a draft save completes
**When** in the sell flow
**Then** I see "💾 Sauvegardé" briefly appear in the header
**And** it fades out after 2 seconds

**Given** a draft save is in progress
**When** waiting for save
**Then** I see a subtle spinner in the header

**Given** a draft is 7-14 days old
**When** I open the resume modal
**Then** I see a warning "Ce brouillon expire bientôt"

**Given** a draft is older than 14 days
**When** the app launches
**Then** the draft is automatically deleted
**And** associated images are cleaned up

**Given** I successfully publish an article
**When** publication completes
**Then** the draft is automatically deleted
**And** cached images are cleaned up

---

## Epic 6: Auth & Onboarding Refactor (Browse First)

L'utilisateur peut explorer l'app sans compte, avec une inscription contextuelle déclenchée par des actions à valeur (like, message, achat, swap party). La personnalisation se fait progressivement via le comportement.

**User Outcome:** "Je peux voir les articles immédiatement, et m'inscrire seulement quand je veux agir"

**Architecture Reference:** `_bmad-output/planning-artifacts/architecture-auth-onboarding.md`

**Key Deliverables:**
- Suppression Facebook Auth
- Browse First (feed sans compte)
- Inscription contextuelle avec messages personnalisés
- Tracking comportement guest
- Génération profil style avec Gemini
- Section "Pour toi" personnalisée

---

### Story 6.1: Foundation - Remove Facebook & Simplify Routing

**As a** user,
**I want** to access the app feed immediately without barriers,
**So that** I can browse articles before deciding to create an account.

**Acceptance Criteria:**

**Given** the app launches
**When** loading completes
**Then** I am navigated directly to the feed (tabs)
**And** I do NOT see an onboarding flow
**And** I do NOT see a login requirement

**Given** I am a guest user
**When** I browse the feed
**Then** I can see all articles
**And** I can search and filter
**And** I can view article details

**Given** the auth screen is shown
**When** I view login options
**Then** I see Email, Google, and Apple options
**And** I do NOT see a Facebook option

**Given** I was previously logged in
**When** I return to the app
**Then** I am still logged in
**And** I do NOT see onboarding again

**Tasks:**
- [ ] Task 1: Remove Facebook Auth (AC: 3)
  - [ ] Remove signInWithFacebook from authService.ts
  - [ ] Remove Facebook button from auth.tsx
  - [ ] Remove Facebook config from app.json
  - [ ] Remove react-native-fbsdk-next dependency
- [ ] Task 2: Update Firestore Rules (AC: 2)
  - [ ] Add public read on articles collection
  - [ ] Keep authenticated write rules
  - [ ] Deploy updated rules
- [ ] Task 3: Simplify Routing (AC: 1, 4)
  - [ ] Update app/index.tsx to always route to /(tabs)
  - [ ] Remove isFirstLaunch logic
  - [ ] Remove onboarding route references
- [ ] Task 4: Cleanup Onboarding Files (AC: 1)
  - [ ] Delete app/onboarding.tsx
  - [ ] Delete components/onboarding/ folder

---

### Story 6.2: Guest State Management

**As a** guest user,
**I want** my browsing session to be tracked locally,
**So that** my preferences can be preserved when I create an account.

**Acceptance Criteria:**

**Given** I open the app without an account
**When** the app initializes
**Then** a guest session is created with a unique guestId
**And** the session is stored in AsyncStorage

**Given** I am a guest
**When** I view an article for more than 3 seconds
**Then** the article metadata is saved to my guest session

**Given** I am a guest
**When** I perform a search
**Then** my search query is saved to my guest session

**Given** I close and reopen the app
**When** I am still a guest
**Then** my previous guest session is restored

**Tasks:**
- [ ] Task 1: Extend AuthContext (AC: 1, 4)
  - [ ] Add isGuest boolean state
  - [ ] Add guestSession state
  - [ ] Add initGuestSession method
  - [ ] Add mergeGuestToUser method
- [ ] Task 2: Create guestPreferencesService (AC: 1, 2, 3, 4)
  - [ ] Implement AsyncStorage CRUD for guest session
  - [ ] Use GUEST_KEYS constants
  - [ ] Include timestamps in all data
- [ ] Task 3: Create useGuestTracking hook (AC: 2, 3)
  - [ ] Implement trackView function
  - [ ] Implement trackSearch function
  - [ ] Implement trackLike function

---

### Story 6.3: Contextual Auth Triggers

**As a** guest user,
**I want** to see a contextual signup prompt when I try to perform protected actions,
**So that** I understand why I need an account.

**Acceptance Criteria:**

**Given** I am a guest and tap the like button
**When** the action is triggered
**Then** I see a modal with message "Crée un compte pour sauvegarder tes coups de coeur"
**And** I see Email, Google, Apple signup options

**Given** I am a guest and try to message a seller
**When** the action is triggered
**Then** I see a modal with message "Inscris-toi pour contacter le vendeur"

**Given** I am a guest and try to buy
**When** the action is triggered
**Then** I see a modal with message "Crée un compte pour finaliser ton achat"

**Given** I am a guest and try to join a Swap Party
**When** the action is triggered
**Then** I see a modal with message "Inscris-toi pour participer à cette Swap Party"

**Given** I complete signup from a trigger
**When** authentication succeeds
**Then** the original action is completed automatically
**And** my guest preferences are merged to my account

**Tasks:**
- [ ] Task 1: Extend AuthRequiredContext (AC: 1, 2, 3, 4)
  - [ ] Add message option to requireAuth
  - [ ] Add onSuccess callback option
  - [ ] Add onCancel callback option
- [ ] Task 2: Create AUTH_MESSAGES constants (AC: 1, 2, 3, 4)
  - [ ] Define all 6 contextual messages
- [ ] Task 3: Update components with triggers (AC: 1, 2, 3, 4, 5)
  - [ ] Update like button with requireAuth
  - [ ] Update message button with requireAuth
  - [ ] Update buy button with requireAuth
  - [ ] Update swap party join with requireAuth

---

### Story 6.4: Style Profile Generation with Gemini

**As a** new user,
**I want** the app to understand my style based on my browsing behavior,
**So that** I get personalized recommendations immediately.

**Acceptance Criteria:**

**Given** I have browsed 15+ articles as guest
**When** I create an account
**Then** my guest behavior is sent to Gemini for analysis
**And** a style profile is generated

**Given** Gemini analyzes my behavior
**When** generating my profile
**Then** I receive styleTags (e.g., "Streetwear", "Vintage")
**And** I receive a styleDescription in French
**And** I receive recommendedBrands
**And** I receive suggestedSizes

**Given** Gemini fails or times out
**When** profile generation fails
**Then** a default empty profile is used
**And** no error is shown to user

**Given** my profile is generated
**When** stored in Firestore
**Then** it is saved to users/{uid}/preferences

**Tasks:**
- [ ] Task 1: Create generateStyleProfile Cloud Function (AC: 1, 2, 3, 4)
  - [ ] Create function in functions/src/generateStyleProfile.ts
  - [ ] Implement Gemini API call with structured prompt
  - [ ] Parse and validate response
  - [ ] Handle errors with default profile
- [ ] Task 2: Integrate profile generation on signup (AC: 1, 4)
  - [ ] Call generateStyleProfile after account creation
  - [ ] Merge guest data before calling
  - [ ] Store result in Firestore

---

### Story 6.5: "Pour Toi" Personalized Section

**As a** logged-in user with preferences,
**I want** to see a personalized "Pour toi" section on the home feed,
**So that** I discover articles matching my style.

**Acceptance Criteria:**

**Given** I have a style profile
**When** I view the home feed
**Then** I see a "Pour toi" section near the top
**And** it displays articles matching my preferences

**Given** my profile includes topBrands
**When** loading "Pour toi" articles
**Then** articles from those brands are prioritized

**Given** my profile includes sizes
**When** loading "Pour toi" articles
**Then** articles in my sizes are prioritized

**Given** I don't have a style profile yet
**When** I view the home feed
**Then** I do NOT see a "Pour toi" section
**And** I see the regular feed

**Tasks:**
- [ ] Task 1: Create ForYouSection component (AC: 1, 2, 3)
  - [ ] Create horizontal scrollable article list
  - [ ] Add "Pour toi" header with style tag badges
  - [ ] Query articles based on user preferences
- [ ] Task 2: Integrate on home screen (AC: 1, 4)
  - [ ] Add ForYouSection to app/(tabs)/index.tsx
  - [ ] Conditionally render based on profile existence
  - [ ] Position above main feed
