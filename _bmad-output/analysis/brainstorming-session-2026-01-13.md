---
stepsCompleted: [1, 2, 3]
inputDocuments: []
session_topic: 'Design System complet pour marketplace jeune et chic'
session_goals: 'Typographie, Couleurs, Composants, Tokens, Micro-animations'
selected_approach: 'AI-Recommended'
techniques_used: ['Cross-Pollination', 'SCAMPER Method']
ideas_generated: [42]
context_file: ''
---

# Brainstorming Session Results

**Facilitator:** Aurelienrouchy
**Date:** 2026-01-13

## Session Overview

**Topic:** Refonte complète du Design System pour Seconde

**Goals:**
- Créer une identité visuelle jeune et chic (style Luxe Français + Street)
- Typographie parfaite - lisible et élégante
- Palette de couleurs impactante
- Système de composants cohérents
- Design tokens complets (spacing, shadows, etc.)
- Micro-animations subtiles pour interactions et transitions
- Theme light uniquement

### Contexte du Problème
- Design actuel jugé maladroit et pas beau
- Besoin de codes visuels marketplace moderne
- Équilibre recherché: pratique + impactant, lisible + élégant

### Inspiration Finale
- **Revolut:** Animations fluides, blur/glassmorphism, polish extrême
- **Apple:** Espace blanc maîtrisé, hiérarchie parfaite
- **Luxe Français (Jacquemus, AMI):** Élégance raffinée, sophistication
- **Street/Jeunesse:** Énergie, audace, dynamisme

---

## Technique 1: Cross-Pollination - ADN Visuel

### Couleurs

| Token | Hex | Usage |
|-------|-----|-------|
| `color-background` | `#FAF9F6` | Fond principal crème chaud |
| `color-foreground` | `#1A1A1A` | Texte noir doux |
| `color-primary` | `#002FA7` | Bleu Klein - accent principal |
| `color-primary-light` | `rgba(0,47,167,0.1)` | Bleu Klein 10% |
| `color-secondary` | `#FFFFFF` | Blanc pur (cards, inputs) |
| `color-muted` | `#999999` | Texte secondaire |
| `color-border` | `#E5E5E5` | Bordures subtiles |
| `color-danger` | `#C41E3A` | Erreurs, suppression |
| `color-success` | `#2E7D32` | Succès, disponible |
| `color-warning` | `#F57C00` | Attention, réservé |

### Typographie

| Rôle | Font | Weight | Size |
|------|------|--------|------|
| H1 - Titres principaux | Cormorant Garamond | SemiBold (600) | 28px |
| H2 - Sous-titres | Cormorant Garamond | SemiBold (600) | 22px |
| H3 - Section titles | Cormorant Garamond | Medium (500) | 18px |
| Body | Satoshi | Regular (400) | 16px |
| Body Small | Satoshi | Regular (400) | 14px |
| Labels / UI | Satoshi | Medium (500) | 14px |
| Buttons | Satoshi | Medium (500) | 16px |
| Caption | Satoshi | Regular (400) | 12px |
| Prix | Satoshi | Bold (700) | 18px |

### Border Radius

| Token | Valeur | Usage |
|-------|--------|-------|
| `radius-sm` | `8px` | Boutons, inputs |
| `radius-md` | `16px` | Cards |
| `radius-lg` | `24px` | Modals, bottom sheets |
| `radius-full` | `9999px` | Avatars, pills |

### Shadows & Effects

| Token | Valeur | Usage |
|-------|--------|-------|
| `shadow-card` | `0 4px 24px rgba(0,0,0,0.06)` | Cards au repos |
| `shadow-button` | `0 2px 8px rgba(0,47,167,0.15)` | Boutons active |
| `shadow-elevated` | `0 8px 32px rgba(0,0,0,0.1)` | Éléments élevés |
| `shadow-top` | `0 -4px 24px rgba(0,0,0,0.06)` | Tab bar |
| `blur-overlay` | `backdrop-blur(20px)` | Modals, overlays |
| `blur-subtle` | `backdrop-blur(10px)` | Headers au scroll |

### Spacing

| Token | Valeur | Usage |
|-------|--------|-------|
| `space-xs` | `4px` | Micro-gaps |
| `space-sm` | `8px` | Entre éléments liés |
| `space-md` | `16px` | Padding standard |
| `space-lg` | `24px` | Sections internes |
| `space-xl` | `32px` | Entre sections |
| `space-2xl` | `48px` | Grandes séparations |
| `space-3xl` | `64px` | Hero spacing |

### Sizing

| Token | Valeur |
|-------|--------|
| `header-height` | `56px` |
| `tab-bar-height` | `64px` + safe area |
| `button-height` | `48px` |
| `input-height` | `48px` |
| `card-image-ratio` | `4:5` (portrait) |

### Animations

| Propriété | Valeur |
|-----------|--------|
| **Niveau général** | 3/5 (noticeable mais pas distrayant) |
| **Duration standard** | `250-300ms` |
| **Easing** | `ease-out` |
| **Spring** | Pour accents (likes, add to cart) |
| **Press scale** | `0.97` (boutons), `0.98` (cards) |
| **Page transition** | Fade 200ms + slideY(20→0) + stagger 50ms |

### Haptic Feedback

| Action | Type |
|--------|------|
| Tap standard | `ImpactFeedbackStyle.Light` |
| Actions importantes | `ImpactFeedbackStyle.Medium` |
| Like / Favori | `NotificationFeedbackType.Success` |
| Erreur | `NotificationFeedbackType.Error` |

---

## Technique 2: SCAMPER - Composants

### Buttons

| Variante | Background | Text | Border | Usage |
|----------|------------|------|--------|-------|
| **Primary** | `#002FA7` | `#FFFFFF` | none | CTA principal |
| **Secondary** | `transparent` | `#002FA7` | `1.5px #002FA7` | Action secondaire |
| **Ghost** | `transparent` | `#002FA7` | none | Liens, tertiaire |
| **Danger** | `transparent` | `#C41E3A` | `1.5px #C41E3A` | Supprimer |
| **Muted** | `#F5F5F5` | `#1A1A1A` | none | Actions neutres |

```
Dimensions:
- Height: 48px
- Padding: 16px 24px
- Radius: 8px
- Font: Satoshi Medium, 16px

Press state:
- Scale: 0.97
- Duration: 150ms
- Haptic: Light
```

### Cards

**Product Card Standard:**
```
- Image ratio: 4:5 (portrait)
- Radius: 16px (top), 16px (bottom)
- Shadow: shadow-card
- Padding content: 12px
- Like button: top-right, coeur avec bounce + haptic

Contenu:
- Titre: Satoshi Medium, 14px
- Marque: Satoshi Regular, 12px, gris
- Prix: Satoshi Bold, 16px, Bleu Klein
- Taille: Satoshi Regular, 12px, gris

Press state:
- Scale: 0.98
- Duration: 100ms
```

**Variantes:**
- Featured: Plus grande, plus d'espace
- Horizontal: Image gauche, infos droite
- Minimal: Image + prix overlay

### Inputs

```
Default:
- Height: 48px
- Background: #FFFFFF
- Border: 1.5px solid #E5E5E5
- Radius: 8px
- Padding: 0 16px
- Font: Satoshi Regular, 16px
- Placeholder: #999999

Focus:
- Border: 1.5px solid #002FA7
- Shadow: 0 0 0 3px rgba(0,47,167,0.1)

Error:
- Border: 1.5px solid #C41E3A

Disabled:
- Background: #F5F5F5
- Opacity: 0.5
```

### Navigation

**Header:**
```
- Height: 56px
- Background: transparent → #FAF9F6 au scroll
- Titre: Cormorant Garamond SemiBold, 18px
- Icônes: 24px
- Blur au scroll: backdrop-blur(10px)
```

**Tab Bar:**
```
- Height: 64px + safe area
- Background: #FFFFFF
- Shadow: shadow-top
- Icônes: 24px

États:
- Inactive: gris #999
- Active: Bleu Klein #002FA7

Bouton Vendre (central):
- Cercle Bleu Klein
- Icône + blanche
- Légèrement elevated
```

### Bottom Sheets

```
Standard:
- Radius top: 24px
- Background: #FFFFFF
- Handle: 36px × 4px, #DDD, radius full
- Padding: 24px

Animation entrée:
- Sheet: translateY(100%) → 0, spring 350ms
- Backdrop: rgba(0,0,0,0.4) + backdrop-blur(10px)
- Haptic: Light à l'ouverture

Variantes:
- Action Sheet: liste d'options 48px chaque
- Modal: centré, scale 0.9 → 1
- Filter Sheet: full height 95%, header/footer sticky
```

### Tags & Badges

**Tags (sélectionnables):**
```
Default:
- Background: #F5F5F5
- Text: #1A1A1A, Satoshi Medium, 14px
- Padding: 8px 16px
- Radius: 8px

Selected:
- Background: #002FA7
- Text: #FFFFFF
- Animation: scale spring + haptic
```

**Badges:**
```
- Padding: 4px 8px
- Radius: 4px
- Font: Satoshi Medium, 12px
- Pas de uppercase (plus chic)
```

**Notification Counter:**
```
- Min size: 18px
- Background: #002FA7
- Text: #FFFFFF, 11px bold
- Position: top-right, offset -4px
```

### Avatars

| Size | Dimension | Usage |
|------|-----------|-------|
| XS | 24px | Listes compactes |
| S | 32px | Comments |
| M | 40px | Cards vendeur |
| L | 56px | Headers profil |
| XL | 80px | Page profil |
| XXL | 120px | Edit profil |

```
Style:
- Shape: Cercle (border-radius: 50%)
- Border: 2px solid #FFFFFF
- Shadow: 0 2px 8px rgba(0,0,0,0.1)
- Placeholder: Initiales sur fond Bleu Klein

Online indicator:
- Dot vert 10px
- Position: bottom-right
- Border: 2px solid white
```

### Price Display

```
Standard:
- Font: Satoshi Bold, 18px
- Color: #002FA7 (Bleu Klein)

Promo:
- Ancien prix: gris, line-through
- Nouveau prix: Bleu Klein
```

### Empty States

```
- Illustration: style ligne simple
- Titre: Cormorant Garamond, 20px
- Description: Satoshi Regular, 14px, gris
- CTA: Button Primary
- Padding: space-2xl
```

---

## Session Highlights

**ADN du Design System:**
> Luxe Français + Street Energy + Revolut Polish

**Signature visuelle:**
- Bleu Klein comme accent distinctif
- Cormorant pour l'élégance éditoriale
- Satoshi pour la lisibilité moderne
- Animations niveau 3 avec haptic feedback
- Glassmorphism sur les overlays

**Principes clés:**
1. Plus d'espace = plus premium
2. Le prix toujours en Bleu Klein (il doit pop)
3. Animations smooth avec micro-spring sur les interactions fun
4. Haptic feedback sur toutes les actions importantes
5. Blur > Shadow pour les overlays (style Revolut)

---

*Session facilitée par Carson, Elite Brainstorming Specialist*
*Techniques utilisées: Cross-Pollination, SCAMPER Method*
