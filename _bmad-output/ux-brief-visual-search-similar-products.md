# UX Brief: Visual Search + Similar Products

**Date:** 2026-01-11
**Auteur:** Mary (Business Analyst)
**Version:** 1.0

---

## 1. Objectifs

### Feature 1: Visual Search (Recherche par Image)
Permettre aux utilisateurs de prendre une photo d'un produit et trouver des articles similaires dans le catalogue.

### Feature 2: Similar Products (Produits Similaires Améliorés)
Améliorer les recommandations de produits similaires sur la page article avec un algorithme IA multi-critères.

---

## 2. Parcours Utilisateur

### 2.1 Visual Search - Flow Principal

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Home/Feed     │────▶│  SearchOverlay  │────▶│  Camera View    │
│                 │     │  + Bouton 📷    │     │  (capture)      │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                                                        │
                                                        ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│ Search Results  │◀────│  Loading +      │◀────│  Preview +      │
│ "Résultats      │     │  "Analyse en    │     │  Confirm        │
│  visuels"       │     │   cours..."     │     │                 │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

### 2.2 Entry Points (Points d'Entrée)

| Emplacement | Élément UI | Priorité |
|-------------|------------|----------|
| SearchOverlay Header | Icône caméra à droite du champ recherche | **P1** |
| Home Feed | Bouton flottant ou dans la barre de recherche | P2 |
| Article Detail | "Trouver des produits similaires" (option) | P3 |

### 2.3 Mockup - SearchOverlay avec Visual Search

```
┌─────────────────────────────────────────────┐
│  ←  │ 🔍 Rechercher...        │ 📷 │  OK  │
├─────────────────────────────────────────────┤
│  [ Recherche ]  [ Catégories ]  [ Photo ]   │  ← Nouveau tab optionnel
├─────────────────────────────────────────────┤
│                                             │
│  Recherches récentes                        │
│  ─────────────────                          │
│  • Veste cuir noir                    ✕     │
│  • Nike Air Max                       ✕     │
│  • Sac Longchamp                      ✕     │
│                                             │
└─────────────────────────────────────────────┘
```

**Option recommandée:** Bouton caméra dans le header (comme Pinterest/ASOS)

---

## 3. Visual Search - Écrans Détaillés

### 3.1 Camera View (Réutiliser CameraCapture.tsx)

```
┌─────────────────────────────────────────────┐
│                                    [Flip]   │
│                                             │
│                                             │
│           ┌─────────────────┐               │
│           │                 │               │
│           │   Viewfinder    │               │
│           │   (Guide frame) │               │
│           │                 │               │
│           └─────────────────┘               │
│                                             │
│  "Cadrez le produit à rechercher"           │
│                                             │
│     [Galerie]    ( ● )    [Annuler]         │
└─────────────────────────────────────────────┘
```

**Différences avec CameraCapture existant:**
- Une seule photo (pas multiple)
- Frame/guide pour cadrer le produit
- Texte d'aide contextuel
- Bouton Annuler au lieu de compteur

### 3.2 Preview + Confirm

```
┌─────────────────────────────────────────────┐
│  ←  Recherche visuelle                      │
├─────────────────────────────────────────────┤
│                                             │
│           ┌─────────────────┐               │
│           │                 │               │
│           │   Photo prise   │               │
│           │                 │               │
│           └─────────────────┘               │
│                                             │
│  ┌───────────────────────────────────────┐  │
│  │ [Reprendre]      [Rechercher]         │  │
│  └───────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
```

### 3.3 Loading State

```
┌─────────────────────────────────────────────┐
│  ←  Recherche visuelle                      │
├─────────────────────────────────────────────┤
│                                             │
│           ┌─────────────────┐               │
│           │   [Photo]       │               │
│           │   (flou/dim)    │               │
│           └─────────────────┘               │
│                                             │
│              ◠ ◡ ◠  (spinner)               │
│                                             │
│         "Analyse de l'image..."             │
│     "Recherche de produits similaires"      │
│                                             │
└─────────────────────────────────────────────┘
```

### 3.4 Results Screen

```
┌─────────────────────────────────────────────┐
│  ←  Résultats visuels           [Filtres]   │
├─────────────────────────────────────────────┤
│  ┌────────┐                                 │
│  │ Photo  │  12 résultats trouvés           │
│  │ source │  "Veste en cuir similaire"      │
│  └────────┘                                 │
├─────────────────────────────────────────────┤
│  ┌─────────┐  ┌─────────┐  ┌─────────┐      │
│  │         │  │         │  │         │      │
│  │  Prod1  │  │  Prod2  │  │  Prod3  │      │
│  │  45€    │  │  52€    │  │  38€    │      │
│  │ 92% ✓   │  │ 87% ✓   │  │ 85% ✓   │      │
│  └─────────┘  └─────────┘  └─────────┘      │
│                                             │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐      │
│  │  Prod4  │  │  Prod5  │  │  Prod6  │      │
│  └─────────┘  └─────────┘  └─────────┘      │
└─────────────────────────────────────────────┘
```

**Éléments clés:**
- Miniature de la photo source en haut
- Nombre de résultats + description IA générée
- Badge de similarité (%) sur chaque produit (optionnel)
- Accès aux filtres standard

---

## 4. Similar Products Améliorés

### 4.1 Emplacement Actuel (Conserver)

Page Article (`app/article/[id].tsx`) - Section en bas, après le vendeur.

### 4.2 Design Actuel vs Proposé

**Actuel:**
```
┌─────────────────────────────────────────────┐
│  Produits similaires                        │
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ →         │
│  │     │ │     │ │     │ │     │            │
│  │ 45€ │ │ 52€ │ │ 38€ │ │ 67€ │            │
│  └─────┘ └─────┘ └─────┘ └─────┘            │
└─────────────────────────────────────────────┘
```

**Proposé (avec scoring IA):**
```
┌─────────────────────────────────────────────┐
│  Dans le même style                         │
│  Basé sur: couleur, marque, catégorie       │  ← Subtitle explicatif
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ →         │
│  │ ♥   │ │ ♥   │ │     │ │     │            │
│  │ 45€ │ │ 52€ │ │ 38€ │ │ 67€ │            │
│  │Zara │ │Zara │ │H&M  │ │Mango│            │  ← Marque visible
│  └─────┘ └─────┘ └─────┘ └─────┘            │
└─────────────────────────────────────────────┘
```

### 4.3 Labels Alternatifs

| Label | Contexte |
|-------|----------|
| "Dans le même style" | Default - recommandations générales |
| "De la même marque" | Si filtre marque dominant |
| "Dans la même gamme de prix" | Si prix similaire |
| "Vous aimerez aussi" | Feed personnalisé |

---

## 5. États et Feedback

### 5.1 États de Chargement

| État | Visuel | Message |
|------|--------|---------|
| Capture | Spinner dans bouton | - |
| Analyse | Skeleton + spinner | "Analyse de l'image..." |
| Recherche | Skeleton grid | "Recherche en cours..." |
| Erreur | Alert + retry | "Impossible d'analyser l'image" |
| Aucun résultat | Empty state | "Aucun produit similaire trouvé" |

### 5.2 Empty States

**Visual Search - Pas de résultats:**
```
┌─────────────────────────────────────────────┐
│                                             │
│              📷                             │
│                                             │
│   Aucun produit similaire trouvé            │
│                                             │
│   Essayez avec une photo plus nette         │
│   ou un angle différent                     │
│                                             │
│   [Nouvelle recherche]  [Recherche texte]   │
│                                             │
└─────────────────────────────────────────────┘
```

---

## 6. Accessibilité

| Élément | Accessibilité |
|---------|---------------|
| Bouton caméra | `accessibilityLabel="Rechercher par photo"` |
| Résultats | `accessibilityLabel="X produits similaires trouvés"` |
| Badge similarité | `accessibilityLabel="Similarité: X pourcent"` |

---

## 7. Métriques de Succès

| Métrique | Objectif |
|----------|----------|
| Taux d'utilisation Visual Search | > 5% des recherches |
| Taux de clic sur résultats visuels | > 15% |
| Taux de clic sur Similar Products | > 8% (vs ~3% actuel) |
| Temps moyen analyse | < 3 secondes |

---

## 8. Résumé des Composants à Créer/Modifier

| Composant | Action | Priorité |
|-----------|--------|----------|
| `SearchOverlay/index.tsx` | Ajouter bouton caméra | P1 |
| `VisualSearchCamera.tsx` | Nouveau - capture pour recherche | P1 |
| `VisualSearchResults.tsx` | Nouveau - écran résultats | P1 |
| `SimilarProducts.tsx` | Modifier - intégrer scoring IA | P1 |
| `app/visual-search.tsx` | Nouveau - route | P1 |
| `services/visualSearchService.ts` | Nouveau - appels API | P1 |

---

## 9. Questions Ouvertes

1. **Badge de similarité visible ?**
   - Oui = plus transparent mais peut perturber
   - Non = plus clean mais moins informatif
   - **Recommandation:** Oui, discret (petit badge coin)

2. **Historique des recherches visuelles ?**
   - **Recommandation:** Non pour MVP, ajouter en V2

3. **Partage des résultats visuels ?**
   - **Recommandation:** Non pour MVP

---

*Document généré par Mary, Business Analyst - BMAD Framework*
