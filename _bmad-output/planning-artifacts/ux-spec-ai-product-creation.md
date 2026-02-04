# UX Specification - Création de Produit avec IA

**Date**: 2026-01-10
**Version**: 1.1
**Statut**: Spec complète pour développement
**Scope**: Refonte totale du flow de création d'article avec assistance IA

---

## 1. Vision produit

### Objectif
Transformer la création d'article de **15+ champs manuels** en une expérience **"photo-first"** où l'IA pré-remplit intelligemment les informations, réduisant l'effort utilisateur de 80%.

### Proposition de valeur
> "Prenez une photo, on s'occupe du reste"

### Principes directeurs
1. **Photo d'abord** - L'image est le point d'entrée unique
2. **IA assistante, pas remplaçante** - Suggestions éditables, jamais imposées
3. **Confiance visible** - L'utilisateur voit ce que l'IA a détecté vs deviné
4. **Zéro friction** - Minimum de taps pour publier

---

## 2. Architecture du flow

### Vue d'ensemble

```
[Onglet Vendre]
      │
      ▼
┌─────────────────┐
│  ÉTAPE 1        │
│  Capture Photos │ ◄── Caméra ou Galerie
└────────┬────────┘
         │ Analyse IA (1ère photo)
         ▼
┌─────────────────┐
│  ÉTAPE 2        │
│  Résultats IA   │ ◄── Champs pré-remplis éditables
│  + Édition      │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  ÉTAPE 3        │
│  Prix &         │ ◄── Prix manuel + options livraison
│  Livraison      │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  ÉTAPE 4        │
│  Preview &      │ ◄── Validation finale
│  Publication    │
└────────┬────────┘
         │
         ▼
   [Mes Articles]
```

### Indicateur de progression
- Barre horizontale en haut: `━━━━━━━━━━○○○○`
- 4 étapes, progression fluide
- Possibilité de revenir en arrière

---

## 3. Spécifications par écran

---

### ÉTAPE 1: Capture Photos

#### Layout

```
┌─────────────────────────────────────────┐
│ ✕                                       │
│                                         │
│                                         │
│                                         │
│         ┌───────────────────┐           │
│         │                   │           │
│         │   [CAMERA VIEW]   │           │
│         │                   │           │
│         │                   │           │
│         └───────────────────┘           │
│                                         │
│                                         │
│   ┌─────┐                   ┌─────┐     │
│   │ 🖼️  │                   │  📸 │     │
│   │Gale-│                   │     │     │
│   │rie  │                   │     │     │
│   └─────┘                   └─────┘     │
│                                         │
│         Photos: 0/5                     │
└─────────────────────────────────────────┘
```

#### Composants

| Élément | Description | Comportement |
|---------|-------------|--------------|
| **Header** | Bouton fermer (✕) | Retour à l'accueil avec confirmation si photos prises |
| **Zone caméra** | Viewfinder plein écran | Ratio 4:3 ou 1:1 (configurable) |
| **Bouton galerie** | Coin inférieur gauche | Ouvre ImagePicker, sélection multiple |
| **Bouton capture** | Coin inférieur droit, grand | Prend la photo |
| **Compteur** | "Photos: X/5" | Mise à jour en temps réel |
| **Vignettes** | Sous la caméra (si photos prises) | Scroll horizontal, tap pour supprimer |

#### États

| État | Affichage |
|------|-----------|
| **0 photos** | Bouton "Continuer" désactivé |
| **1+ photos** | Bouton "Analyser avec l'IA" apparaît |
| **5 photos** | Bouton capture désactivé, message "Maximum atteint" |

#### Bouton principal

```
┌─────────────────────────────────────────┐
│   [ ✨ Analyser avec l'IA ]             │
└─────────────────────────────────────────┘
```
- Couleur: Orange (#F79F24)
- Icône: Sparkles (✨) pour indiquer l'IA
- Déclenche l'analyse et passe à l'étape 2

#### Permissions
- Demander permission caméra au premier accès
- Fallback galerie si permission refusée

---

### ÉTAPE 2: Résultats IA + Édition

#### Layout principal

```
┌─────────────────────────────────────────┐
│ ←  Étape 2/4           Vérifiez les     │
│ ━━━━━━━━━━━━━━○○○○     informations     │
├─────────────────────────────────────────┤
│                                         │
│   ┌─────────────────────────────────┐   │
│   │                                 │   │
│   │     [PHOTO PRINCIPALE]          │   │
│   │          200x200                │   │
│   │                                 │   │
│   └─────────────────────────────────┘   │
│   ┌───┐ ┌───┐ ┌───┐ ┌───┐ ┌───┐         │
│   │ 1 │ │ 2 │ │ 3 │ │ 4 │ │ 5 │  thumbs │
│   └───┘ └───┘ └───┘ └───┘ └───┘         │
│                                         │
│   ═══════════════════════════════════   │
│                                         │
│   ✨ Détecté par l'IA                   │
│                                         │
│   Titre                                 │
│   ┌─────────────────────────────────┐   │
│   │ Robe fleurie été              ✏️│   │
│   └─────────────────────────────────┘   │
│   🤖 Confiance: Haute                   │
│                                         │
│   Description                           │
│   ┌─────────────────────────────────┐   │
│   │ Belle robe d'été à motifs      │   │
│   │ floraux, coupe fluide...     ✏️│   │
│   └─────────────────────────────────┘   │
│   🤖 Confiance: Haute                   │
│                                         │
│   ─────────────────────────────────     │
│                                         │
│   Catégorie                             │
│   ┌─────────────────────────────────┐   │
│   │ 👗 Robes                       ›│   │
│   │    dans Femmes · Vêtements      │   │
│   └─────────────────────────────────┘   │
│   🤖 Confiance: Haute                   │
│                                         │
│   État                                  │
│   ┌─────────────────────────────────┐   │
│   │ Très bon état                 ▼│   │
│   └─────────────────────────────────┘   │
│   🤖 Confiance: Moyenne                 │
│                                         │
│   Couleur                               │
│   ┌─────────────────────────────────┐   │
│   │ ✨ Détectées sur la photo       │   │
│   │ ┌──────┐ ┌───────┐ ┌──────┐     │   │
│   │ │🔴Rouge│ │🟡Jaune│ │🟢Vert│     │   │
│   │ └──────┘ └───────┘ └──────┘     │   │
│   │                                 │   │
│   │ 📋 Toutes les couleurs         ›│   │
│   └─────────────────────────────────┘   │
│   🤖 Confiance: Haute                   │
│                                         │
│   Matière                               │
│   ┌─────────────────────────────────┐   │
│   │ ✨ Probables                    │   │
│   │ ┌────────┐ ┌────────┐           │   │
│   │ │ Coton  │ │  Lin   │           │   │
│   │ └────────┘ └────────┘           │   │
│   │                                 │   │
│   │ 📋 Toutes les matières         ›│   │
│   └─────────────────────────────────┘   │
│   🤖 Confiance: Moyenne                 │
│                                         │
│   ─────────────────────────────────     │
│                                         │
│   ⚠️ À compléter                        │
│                                         │
│   Taille *                              │
│   ┌─────────────────────────────────┐   │
│   │ ✨ Suggérées pour Robes         │   │
│   │ ┌────┐ ┌────┐ ┌────┐ ┌────┐     │   │
│   │ │ S  │ │ M  │ │ L  │ │ XL │     │   │
│   │ └────┘ └────┘ └────┘ └────┘     │   │
│   │                                 │   │
│   │ 📋 Toutes les tailles          ›│   │
│   └─────────────────────────────────┘   │
│   ℹ️ Sélectionnez la taille exacte      │
│                                         │
│   Marque                                │
│   ┌─────────────────────────────────┐   │
│   │ + Ajouter une marque (optionnel)│   │
│   └─────────────────────────────────┘   │
│   ℹ️ Aucune marque détectée             │
│                                         │
├─────────────────────────────────────────┤
│                                         │
│   [         Continuer         ]         │
│                                         │
└─────────────────────────────────────────┘
```

#### Sections

**Section 1: Photos**
- Photo principale grande (200x200 ou pleine largeur)
- Vignettes des autres photos en dessous
- Tap sur vignette = devient principale (réorganisation)

**Section 2: Détecté par l'IA**
Champs pré-remplis par l'IA avec indicateur de confiance:

| Champ | Type input | Édition |
|-------|-----------|---------|
| **Titre** | TextInput | Inline, tap pour éditer |
| **Description** | TextArea | Inline, tap pour éditer |
| **Catégorie** | Selector | Bottom sheet hiérarchique, affichage: icône + nom + contexte subtil |
| **État** | Dropdown | 4 options |
| **Couleur** | Smart Selector | Chips IA suggérées + accès liste complète |
| **Matière** | Smart Selector | Chips IA suggérées + accès liste complète |
| **Taille** | Smart Selector | Chips contextuelles (selon catégorie) + accès liste complète |

**Section 3: À compléter**
Champs que l'IA n'a pas pu remplir:

| Champ | Type | Note |
|-------|------|------|
| **Taille** | Selector | "Non détectable sur photo" |
| **Marque** | TextInput | "Aucune marque détectée - Ajouter?" |

#### Indicateurs de confiance IA

| Niveau | Icône | Couleur | Signification |
|--------|-------|---------|---------------|
| **Haute** | 🤖 | Vert (#22C55E) | L'IA est sûre à 80%+ |
| **Moyenne** | 🤖 | Orange (#F79F24) | L'IA est sûre à 50-80% |
| **Basse** | 🤖 | Rouge (#EF4444) | L'IA devine (<50%) |

#### Comportement d'édition inline

```
État normal:
┌─────────────────────────────────────┐
│ Robe fleurie été                  ✏️│
└─────────────────────────────────────┘

État édition (tap):
┌─────────────────────────────────────┐
│ Robe fleurie été█                   │
└─────────────────────────────────────┘
│ [Annuler]              [Confirmer] │
```

#### Validation
- **Titre**: Requis, non vide
- **Description**: Requis, non vide
- **Catégorie**: Requis
- **État**: Requis (défaut: suggestion IA)
- **Taille**: Requis pour vêtements/chaussures
- **Marque**: Optionnel
- **Couleur**: Optionnel (mais pré-rempli)
- **Matière**: Optionnel (mais pré-rempli)

---

### ÉTAPE 3: Prix & Livraison

#### Layout

```
┌─────────────────────────────────────────┐
│ ←  Étape 3/4               Prix &       │
│ ━━━━━━━━━━━━━━━━━━━○○      Livraison    │
├─────────────────────────────────────────┤
│                                         │
│   💰 Fixez votre prix                   │
│                                         │
│   ┌─────────────────────────────────┐   │
│   │                                 │   │
│   │           [    ] €              │   │
│   │                                 │   │
│   └─────────────────────────────────┘   │
│                                         │
│   ═══════════════════════════════════   │
│                                         │
│   🚚 Options de livraison               │
│                                         │
│   ┌─────────────────────────────────┐   │
│   │ ☑️ Remise en main propre        │   │
│   │    Rencontrez l'acheteur        │   │
│   │                                 │   │
│   │    📍 Quartier                  │   │
│   │    ┌─────────────────────────┐  │   │
│   │    │ Choisir un quartier   ›│  │   │
│   │    └─────────────────────────┘  │   │
│   └─────────────────────────────────┘   │
│                                         │
│   ┌─────────────────────────────────┐   │
│   │ ☑️ Livraison                    │   │
│   │    Mondial Relay, Colissimo...  │   │
│   │                                 │   │
│   │    📦 Taille du colis           │   │
│   │    ┌───────┐┌───────┐┌───────┐  │   │
│   │    │ Petit ││▶Moyen ││ Grand │  │   │
│   │    │ <500g ││ <1kg  ││ <2kg  │  │   │
│   │    └───────┘└───────┘└───────┘  │   │
│   │    ✨ Suggéré par l'IA          │   │
│   └─────────────────────────────────┘   │
│                                         │
├─────────────────────────────────────────┤
│                                         │
│   [         Continuer         ]         │
│                                         │
└─────────────────────────────────────────┘
```

#### Composants

**Prix**
- Input numérique grand et centré
- Clavier numérique
- Placeholder: "0.00"
- Validation: > 0

**Options de livraison**
- 2 cartes checkbox (peuvent être cochées ensemble)
- Au moins une option requise

**Remise en main propre**
- Si cochée: affiche sélecteur de quartier
- Bottom sheet `NeighborhoodBottomSheet`
- Requis si option cochée

**Livraison**
- Si cochée: affiche sélection taille colis
- 3 cartes: Petit / Moyen / Grand
- **Auto-suggestion IA**: basée sur la catégorie détectée
- Label "✨ Suggéré par l'IA" sous la sélection

#### Validation étape 3
- Prix > 0
- Au moins une option de livraison
- Si main propre: quartier sélectionné
- Si livraison: taille colis sélectionnée

---

### ÉTAPE 4: Preview & Publication

#### Layout

```
┌─────────────────────────────────────────┐
│ ←  Étape 4/4              Vérifiez      │
│ ━━━━━━━━━━━━━━━━━━━━━━━━   votre annonce│
├─────────────────────────────────────────┤
│                                         │
│   ┌─────────────────────────────────┐   │
│   │                                 │   │
│   │                                 │   │
│   │     [PHOTO PRINCIPALE]          │   │
│   │        Pleine largeur           │   │
│   │                                 │   │
│   │                                 │   │
│   └─────────────────────────────────┘   │
│   ● ○ ○ ○ ○  (indicateur carousel)      │
│                                         │
│   Robe fleurie été                      │
│   ──────────────────────────────────    │
│                                         │
│   💰 25,00 €                            │
│                                         │
│   👗 Robes                              │
│   📏 Taille M                           │
│   ✨ Très bon état                      │
│   🎨 Multicolore                        │
│   🧵 Coton                              │
│                                         │
│   ──────────────────────────────────    │
│                                         │
│   "Belle robe d'été à motifs floraux,   │
│   coupe fluide parfaite pour les        │
│   journées ensoleillées..."             │
│                                         │
│   ──────────────────────────────────    │
│                                         │
│   🚚 Livraison disponible               │
│   🤝 Meetup: Quartier Latin             │
│                                         │
│   ──────────────────────────────────    │
│                                         │
│   ✏️ Modifier                            │
│                                         │
├─────────────────────────────────────────┤
│                                         │
│   [    ✨ Publier l'article    ]        │
│                                         │
└─────────────────────────────────────────┘
```

#### Composants

**Carousel photos**
- Swipe horizontal
- Indicateurs points en dessous
- Pleine largeur, ratio 4:3

**Informations**
- Affichage lecture seule
- Icônes pour chaque attribut
- Style identique à la vue acheteur

**Bouton Modifier**
- Retourne à l'étape 2
- Conserve toutes les données

**Bouton Publier**
- Orange (#F79F24)
- Icône sparkles (✨)
- État loading: spinner + "Publication en cours..."

#### Post-publication
- Animation de succès (confetti ou check animé)
- Redirection vers "Mes articles"
- Toast: "Article publié avec succès!"

---

## 4. Intégration IA (Gemini)

### Prompt système

```
Tu es un assistant spécialisé dans l'analyse d'articles de mode et d'objets
pour une marketplace de seconde main style Vinted.

Analyse cette image et extrais les informations suivantes en JSON:

{
  "title": "Titre court et descriptif (max 50 caractères)",
  "description": "Description vendeuse de 2-3 phrases",
  "category": {
    "path": ["Niveau1", "Niveau2", "Niveau3"],
    "icon": "emoji représentatif",
    "confidence": 0.0-1.0
  },
  "condition": {
    "value": "neuf|très bon état|bon état|satisfaisant",
    "confidence": 0.0-1.0
  },
  "colors": {
    "detected": ["couleur1", "couleur2", ...],
    "primary": "couleur principale",
    "confidence": 0.0-1.0
  },
  "materials": {
    "detected": ["matière1", "matière2", ...],
    "primary": "matière principale ou null",
    "confidence": 0.0-1.0
  },
  "sizes": {
    "suggested": ["S", "M", "L", ...],
    "context": "type de vêtement pour adapter les tailles"
  },
  "brand": {
    "value": "marque si visible ou null",
    "confidence": 0.0-1.0
  },
  "suggestedPackageSize": "small|medium|large"
}

Règles:
- Sois précis mais concis
- Indique ta confiance pour chaque champ (0.0 à 1.0)
- Si tu ne peux pas déterminer un champ, mets null
- Pour la catégorie, utilise la hiérarchie: Genre > Type > Sous-type
- Pour l'état, base-toi sur l'usure visible
- Pour les couleurs: détecte TOUTES les couleurs visibles (max 5), indique la principale
- Pour les matières: suggère les 2-3 matières les plus probables
- Pour les tailles: suggère les tailles pertinentes selon le type d'article
```

### Mapping des catégories

Le modèle doit mapper vers les catégories existantes dans `/data/categories-v2.ts`:

| Réponse IA | CategoryIds |
|------------|-------------|
| ["Femmes", "Vêtements", "Robes"] | ["femmes", "vetements", "robes"] |
| ["Hommes", "Chaussures", "Sneakers"] | ["hommes", "chaussures", "sneakers"] |
| etc. | ... |

### Gestion des erreurs IA

| Erreur | Comportement |
|--------|--------------|
| Timeout (>10s) | Afficher message + permettre saisie manuelle |
| Réponse invalide | Fallback saisie manuelle avec message |
| Confiance < 30% | Marquer comme "À vérifier" |
| Champ null | Afficher dans section "À compléter" |

### Appel API

```typescript
// Service: services/aiService.ts

interface AIAnalysisResult {
  title: string;
  description: string;
  category: {
    path: string[];
    categoryIds: string[];
    icon: string;  // emoji
    confidence: number;
  };
  condition: {
    value: ArticleCondition;
    confidence: number;
  };
  colors: {
    detected: string[];  // Toutes les couleurs détectées
    primary: string | null;  // Couleur principale sélectionnée par défaut
    confidence: number;
  };
  materials: {
    detected: string[];  // Matières suggérées
    primary: string | null;  // Matière principale sélectionnée par défaut
    confidence: number;
  };
  sizes: {
    suggested: string[];  // Tailles pertinentes pour ce type d'article
    context: string;  // Ex: "robes femmes", "chaussures hommes"
  };
  brand: {
    value: string | null;
    confidence: number;
  };
  suggestedPackageSize: 'small' | 'medium' | 'large';
}

async function analyzeProductImage(imageUri: string): Promise<AIAnalysisResult>
```

---

## 5. Gestion d'état

### Structure du state

```typescript
interface ProductCreationState {
  // Étape 1
  images: ImageAsset[];

  // Étape 2 - Résultats IA
  aiAnalysis: AIAnalysisResult | null;
  isAnalyzing: boolean;
  analysisError: string | null;

  // Étape 2 - Données éditées
  title: string;
  description: string;
  categoryIds: string[];
  condition: ArticleCondition;
  color: string | null;
  material: string | null;
  size: string | null;
  brand: string | null;

  // Tracking des modifications utilisateur
  userEdits: {
    title: boolean;
    description: boolean;
    category: boolean;
    condition: boolean;
    color: boolean;
    material: boolean;
  };

  // Étape 3
  price: string;
  isHandDelivery: boolean;
  isShipping: boolean;
  neighborhood: MeetupNeighborhood | null;
  packageSize: 'small' | 'medium' | 'large' | null;

  // Navigation
  currentStep: 1 | 2 | 3 | 4;

  // Publication
  isPublishing: boolean;
  publishError: string | null;
}
```

---

## 5bis. Gestion des brouillons

### Comportement de sauvegarde automatique

| Événement | Action |
|-----------|--------|
| Photo ajoutée (étape 1) | Sauvegarde images uniquement |
| Analyse IA terminée (étape 2) | Sauvegarde complète avec résultats IA |
| Modification d'un champ | Sauvegarde immédiate (debounced 500ms) |
| Changement d'étape | Sauvegarde complète |
| App en background | Sauvegarde immédiate |
| App fermée/crash | Données persistées grâce aux sauvegardes précédentes |

### Structure du brouillon

```typescript
// Service: services/draftService.ts

interface ArticleDraft {
  id: string;  // UUID généré à la création
  createdAt: Date;
  updatedAt: Date;
  currentStep: 1 | 2 | 3 | 4;

  // Étape 1
  images: {
    uri: string;
    localPath: string;  // Copie locale pour persistence
  }[];

  // Étape 2
  aiAnalysis: AIAnalysisResult | null;
  editedFields: {
    title: string;
    description: string;
    categoryIds: string[];
    categoryIcon: string;
    condition: ArticleCondition;
    selectedColor: string | null;
    selectedMaterial: string | null;
    selectedSize: string | null;
    brand: string | null;
  };

  // Étape 3
  pricing: {
    price: string;
    isHandDelivery: boolean;
    isShipping: boolean;
    neighborhood: MeetupNeighborhood | null;
    packageSize: 'small' | 'medium' | 'large' | null;
  };
}

// Clé AsyncStorage
const DRAFT_KEY = '@article_draft';

// API du service
class DraftService {
  async saveDraft(draft: ArticleDraft): Promise<void>
  async loadDraft(): Promise<ArticleDraft | null>
  async deleteDraft(): Promise<void>
  async hasDraft(): Promise<boolean>
}
```

### UX de reprise de brouillon

**Au lancement de l'onglet Vendre:**

```
┌─────────────────────────────────────────┐
│                                         │
│   📝 Brouillon trouvé                   │
│                                         │
│   ┌─────────────────────────────────┐   │
│   │  [Thumbnail]  Robe fleurie été  │   │
│   │               Étape 2/4         │   │
│   │               Il y a 2 heures   │   │
│   └─────────────────────────────────┘   │
│                                         │
│   [  Reprendre le brouillon  ]          │
│                                         │
│   [  Commencer un nouvel article  ]     │
│                                         │
└─────────────────────────────────────────┘
```

**Comportements:**
- "Reprendre" → Restaure l'état et navigue vers `currentStep`
- "Nouveau" → Supprime le brouillon, démarre étape 1
- Le brouillon est automatiquement supprimé après publication réussie

### Indicateur de sauvegarde

Afficher un indicateur subtil dans le header:
- 💾 "Sauvegardé" (apparaît 2s après chaque sauvegarde)
- 🔄 Spinner discret pendant la sauvegarde
- Pas d'indicateur le reste du temps

### Gestion des images en brouillon

```typescript
// Les images sont copiées localement pour éviter les problèmes de cache
async function saveImageLocally(uri: string): Promise<string> {
  const filename = `draft_${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`;
  const localPath = `${FileSystem.cacheDirectory}drafts/${filename}`;
  await FileSystem.copyAsync({ from: uri, to: localPath });
  return localPath;
}

// Nettoyage des images orphelines
async function cleanupOrphanedDraftImages(): Promise<void> {
  // Appelé au démarrage de l'app
  // Supprime les images de brouillons expirés (> 7 jours)
}
```

### Expiration des brouillons

| Durée | Action |
|-------|--------|
| < 7 jours | Brouillon disponible normalement |
| 7-14 jours | Avertissement "Ce brouillon expire bientôt" |
| > 14 jours | Suppression automatique au prochain lancement |

---

## 6. Navigation et transitions

### Flow de navigation

```
app/
├── (tabs)/
│   └── sell.tsx  ──► Redirige vers /sell/capture si pas de draft
│
└── sell/
    ├── _layout.tsx      ──► Stack navigator
    ├── capture.tsx      ──► Étape 1
    ├── details.tsx      ──► Étape 2
    ├── pricing.tsx      ──► Étape 3
    └── preview.tsx      ──► Étape 4
```

### Transitions
- Push entre étapes (possibilité de retour)
- Pop sur bouton retour
- Reset stack après publication

### Gestion du retour
- Étape 1 → Confirmation si photos prises
- Étape 2-4 → Retour simple, données conservées
- Hardware back → Même comportement

---

## 7. Composants à créer/modifier

### Nouveaux composants

| Composant | Fichier | Description |
|-----------|---------|-------------|
| `CameraCapture` | `/components/sell/CameraCapture.tsx` | Écran caméra avec galerie |
| `AIAnalysisLoader` | `/components/sell/AIAnalysisLoader.tsx` | Animation pendant analyse |
| `EditableField` | `/components/sell/EditableField.tsx` | Champ éditable inline |
| `ConfidenceIndicator` | `/components/sell/ConfidenceIndicator.tsx` | Badge confiance IA |
| `ProductPreview` | `/components/sell/ProductPreview.tsx` | Preview article |
| `StepIndicator` | `/components/sell/StepIndicator.tsx` | Barre de progression |
| `SmartSelector` | `/components/sell/SmartSelector.tsx` | Sélecteur avec suggestions IA + liste complète |
| `CategoryDisplay` | `/components/sell/CategoryDisplay.tsx` | Affichage catégorie (icône + nom + contexte) |
| `DraftResumeModal` | `/components/sell/DraftResumeModal.tsx` | Modal de reprise de brouillon |
| `SaveIndicator` | `/components/sell/SaveIndicator.tsx` | Indicateur de sauvegarde discret |

### Détail: SmartSelector

Le `SmartSelector` est un nouveau pattern de sélection hybride:

```
┌─────────────────────────────────────────┐
│ Couleur                                 │
│                                         │
│ ✨ Détectées                            │
│ ┌──────┐ ┌───────┐ ┌──────┐             │
│ │●Rouge│ │○Jaune │ │○Vert │             │  ← Chips cliquables
│ └──────┘ └───────┘ └──────┘             │     ● = sélectionné
│                                         │
│ 📋 Voir toutes les couleurs            ›│  ← Ouvre bottom sheet
└─────────────────────────────────────────┘
```

**Props:**
```typescript
interface SmartSelectorProps {
  label: string;
  aiSuggestions: string[];  // Options suggérées par l'IA
  selectedValue: string | null;
  onSelect: (value: string) => void;
  allOptions: SelectionOption[];  // Liste complète
  renderChip?: (value: string, selected: boolean) => ReactNode;
  bottomSheetTitle: string;
  bottomSheetType: 'default' | 'color' | 'size';
}
```

**Comportement:**
1. Affiche les suggestions IA en chips cliquables
2. Un seul chip sélectionné à la fois (radio behavior)
3. "Voir tout" ouvre le bottom sheet avec la liste complète
4. Si l'utilisateur choisit dans le bottom sheet, la valeur remplace la sélection

### Composants à modifier

| Composant | Modification |
|-----------|--------------|
| `CategoryBottomSheet` | Ajouter prop `initialValue` pour pré-sélection |
| `SelectionBottomSheet` | Ajouter prop `initialValue` pour pré-sélection |
| `NeighborhoodBottomSheet` | Aucune modification nécessaire |

### Nouveau service

| Service | Fichier | Description |
|---------|---------|-------------|
| `AIService` | `/services/aiService.ts` | Appels Gemini API |
| `DraftService` | `/services/draftService.ts` | Gestion brouillons AsyncStorage |

---

## 8. Design tokens

### Couleurs spécifiques au flow

| Token | Valeur | Usage |
|-------|--------|-------|
| `--ai-accent` | #8B5CF6 (Violet) | Éléments IA |
| `--confidence-high` | #22C55E | Confiance haute |
| `--confidence-medium` | #F79F24 | Confiance moyenne |
| `--confidence-low` | #EF4444 | Confiance basse |
| `--step-active` | #F79F24 | Étape en cours |
| `--step-complete` | #22C55E | Étape terminée |
| `--step-pending` | #E5E7EB | Étape à venir |

### Animations

| Animation | Durée | Timing |
|-----------|-------|--------|
| Analyse IA | Variable | Pulse + texte changeant |
| Transition étapes | 300ms | ease-in-out |
| Apparition champs | 200ms | fade-in + slide-up |
| Confiance badge | 150ms | scale bounce |

---

## 9. Cas limites et erreurs

### Gestion des erreurs

| Scénario | Comportement |
|----------|--------------|
| Pas de connexion | Message + retry button |
| IA timeout | "Analyse plus longue que prévu..." + option manuelle |
| IA échec | Fallback formulaire manuel complet |
| Image corrompue | Message + demander nouvelle photo |
| Upload échoue | Retry automatique x3, puis message erreur |

### Cas limites

| Cas | Gestion |
|-----|---------|
| Photo très sombre | IA retourne confiance basse, avertir utilisateur |
| Objet non reconnu | Catégorie "Autre" suggérée, demander précision |
| Multi-objets sur photo | Analyser objet principal, ignorer background |
| Photo avec texte | Ignorer texte, focus sur l'objet |

---

## 10. Métriques de succès

| Métrique | Cible | Mesure |
|----------|-------|--------|
| Temps création article | < 90 secondes | Analytics |
| Taux complétion | > 80% | Funnel analytics |
| Taux édition IA | < 30% | Tracking modifications |
| Précision catégorie IA | > 85% | Comparaison suggestion/final |
| NPS création | > 40 | Survey in-app |

---

## 11. Plan de migration

### Phase 1: Préparation
- [ ] Créer service AI
- [ ] Setup Firebase Vertex AI / Gemini
- [ ] Créer composants de base

### Phase 2: Nouveau flow
- [ ] Implémenter écran Capture
- [ ] Implémenter écran Détails + IA
- [ ] Implémenter écran Prix & Livraison
- [ ] Implémenter écran Preview

### Phase 3: Tests & polish
- [ ] Tests E2E du flow complet
- [ ] Optimisation performance IA
- [ ] Animation et polish UI

### Phase 4: Rollout
- [ ] Feature flag pour A/B test
- [ ] Rollout progressif 10% → 50% → 100%
- [ ] Monitoring et alertes

---

## Changelog

### v1.1 (2026-01-10)
- **Catégories**: Nouvel affichage avec icône + nom + contexte (remplace breadcrumb)
- **Smart Selectors**: Nouveau pattern pour couleur/matière/taille avec suggestions IA dynamiques
- **Brouillons**: Section dédiée avec sauvegarde automatique, reprise, expiration
- **API IA enrichie**: Retourne maintenant plusieurs couleurs/matières/tailles suggérées

### v1.0 (2026-01-10)
- Version initiale de la spec

---

*Document créé par Mary, Business Analyst - Seconde*
*Prêt pour développement*
